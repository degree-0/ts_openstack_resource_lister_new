import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import * as ExcelJS from 'exceljs';
import { flattenServer, flattenVolume, getProjectToken, getProjects, getServers, getFlavors, getVolumes } from './utils/stc-api';
import {
    ProjectsResponse,
    Server,
    Volume,
    Endpoint,
} from './utils/types.js';
import { createTable } from './utils/excel-helpers';


dotenv.config();

const base64_endpoints: string = process.env.OS_ENDPOINTS_TENANTS || '';
const decoded_endpoints: string = Buffer.from(base64_endpoints, 'base64').toString('utf-8');
const endpoints: Endpoint[] = JSON.parse(decoded_endpoints);
const username: string = process.env.OS_USERNAME || '';
const password: string = process.env.OS_PASSWORD || '';




const main = async () => {
    console.log('[main.ts] Starting OpenStack resource collection...');

    const allFlattenedServers: Record<string, any>[] = [];
    const allFlattenedVolumes: Record<string, any>[] = [];
    //const allFlattenedFlavors: Record<string, any>[] = [];

    // STEP 1: Collect ALL raw servers and volumes from ALL projects and endpoints first
    const allRawServers: Record<string, any>[] = [];
    const allRawVolumes: Record<string, any>[] = [];

    console.log(`[main.ts] Processing ${endpoints.length} endpoint(s)`);

    for (const endpoint of endpoints) {
        console.log(`[${endpoint.domain}] Processing endpoint: ${endpoint.endpoint}`);
        const generalProjectToken = await getProjectToken(endpoint.endpoint, endpoint.domain, username, password, endpoint.initial_project);
        if (!generalProjectToken) {
            throw new Error(`[${endpoint.domain}] Failed to get project token`);
        }

        const projects: ProjectsResponse = await getProjects(endpoint.endpoint, generalProjectToken);
        console.log(`[${endpoint.domain}] Found ${projects.projects.length} projects`);


        if (!projects) {
            throw new Error(`[${endpoint.domain}] Failed to get projects`);
        }

        console.log(`[${endpoint.domain}] 🚀 Processing ${projects.projects.length} project(s) in parallel...`);

        // Process all projects in parallel using Promise.all
        const projectResults = await Promise.all(
            projects.projects.map(async (project) => {
                const projectPrefix = `[${endpoint.domain}] [${project.name}]`;
                console.log(`${projectPrefix} Processing project...`);

                try {
                    const projectToken = await getProjectToken(endpoint.endpoint, endpoint.domain, username, password, project.name);
                    if (!projectToken) {
                        console.error(`${projectPrefix} Failed to get project token`);
                        return { servers: [], volumes: [] };
}

                    // Parallelize flavors, servers, and volumes API calls for better performance
                    console.log(`${projectPrefix} 🚀 Making parallel API calls for flavors, servers, and volumes...`);
                    const [flavors, servers, volumes] = await Promise.all([
                        getFlavors(endpoint.endpoint, projectToken),
                        getServers(endpoint.endpoint, projectToken),
                        getVolumes(endpoint.endpoint, projectToken)
                    ]);

                    console.log(`${projectPrefix} [flavors] Found ${flavors.flavors.length} flavors`);

                    let rawFlattenedServers: Record<string, any>[] = [];
                    if (servers && servers.servers.length > 0) {
                        console.log(`${projectPrefix} [servers] Found ${servers.servers.length} servers`);

                        // Process ALL servers (no sampling)
                        rawFlattenedServers = servers.servers.map((server: Server, index: number) => {
                            const flattened = flattenServer(server, flavors.flavors, endpoint.domain, project.name);
                            return flattened;
                        });

                        console.log(`${projectPrefix} [servers] ✅ Added ${rawFlattenedServers.length} servers to global collection`);
                    } else {
                        console.log(`${projectPrefix} [servers] No servers found`);
                    }

                    let rawFlattenedVolumes: Record<string, any>[] = [];
                    if (volumes?.volumes?.length > 0) {
                        console.log(`${projectPrefix} [volumes] Found ${volumes.volumes.length} volumes`);
                        
                        // Process ALL volumes (no sampling)
                        rawFlattenedVolumes = volumes.volumes.map((volume: Volume, index: number) => {
                            const flattened = flattenVolume(volume, endpoint.domain, project.name);
                            return flattened;
                        });
                        
                        console.log(`${projectPrefix} [volumes] ✅ Added ${rawFlattenedVolumes.length} volumes to global collection`);
                    } else {
                        console.log(`${projectPrefix} [volumes] No volumes found`);
                    }

                    return {
                        servers: rawFlattenedServers,
                        volumes: rawFlattenedVolumes
                    };

    } catch (error) {
                    console.error(`${projectPrefix} ❌ Error processing project:`, error);
                    return { servers: [], volumes: [] };
    }
            })
        );

        // Aggregate results from all projects in this endpoint
        const endpointServers = projectResults.flatMap(result => result.servers);
        const endpointVolumes = projectResults.flatMap(result => result.volumes);

        console.log(`[${endpoint.domain}] ✅ Completed processing ${projects.projects.length} projects: ${endpointServers.length} servers, ${endpointVolumes.length} volumes`);

        // Add to global collections
        allRawServers.push(...endpointServers);
        allRawVolumes.push(...endpointVolumes);
    }

    // STEP 2: Global normalization across ALL servers from ALL projects
    if (allRawServers.length > 0) {
        console.log(`[main.ts] 🌍 GLOBAL NORMALIZATION: Processing ${allRawServers.length} servers from all projects`);
    
        // Collect ALL possible properties from ALL servers across ALL projects
        const allPossibleProps = new Set<string>();
        allRawServers.forEach((server, index) => {
            Object.keys(server).forEach(prop => allPossibleProps.add(prop));
        });

        const sortedAllProps = Array.from(allPossibleProps).sort();
        console.log(`[main.ts] 🔧 Found ${sortedAllProps.length} unique properties across ALL projects`);

        // Normalize ALL servers to have the same properties
        console.log(`[main.ts] 🔄 Normalizing ${allRawServers.length} servers...`);
        const normalizedAllServers = allRawServers.map((server, index) => {
            const normalizedServer: Record<string, any> = {};
            sortedAllProps.forEach(prop => {
                // Preserve numeric values when available, otherwise use appropriate defaults
                if (server[prop] !== undefined) {
                    normalizedServer[prop] = server[prop];
                } else {
                    // Use appropriate defaults based on property name
                    if (prop.includes('flavor_ram') || prop.includes('flavor_vcpus') ||
                        prop.includes('flavor_disk') || prop === 'OS-EXT-STS:power_state') {
                        normalizedServer[prop] = 0; // Numeric fields default to 0
            } else {
                        normalizedServer[prop] = ''; // String fields default to empty string
                    }
                }
            });
            if (index % 500 === 0 && index > 0) { // Less frequent logging for large datasets
                console.log(`[main.ts] ✅ Normalized ${index + 1}/${allRawServers.length} servers`);
            }
            return normalizedServer;
        });

        // Verify ALL servers now have identical property counts
        const expectedPropCount = sortedAllProps.length;
        let allConsistent = true;
        normalizedAllServers.forEach((server, index) => {
            const currentProps = Object.keys(server).length;
            if (currentProps !== expectedPropCount) {
                console.log(`[main.ts] 🚨 GLOBAL INCONSISTENCY! Server ${index} has ${currentProps} props, expected ${expectedPropCount}`);
                allConsistent = false;
                    }
        });

        if (allConsistent) {
            console.log(`[main.ts] ✅ GLOBAL NORMALIZATION SUCCESS: All ${normalizedAllServers.length} servers have exactly ${expectedPropCount} properties`);
        } else {
            console.log(`[main.ts] ❌ GLOBAL NORMALIZATION FAILED: Servers still have inconsistent property counts`);
        }

        allFlattenedServers.push(...normalizedAllServers);
    }

    // STEP 3: Global normalization across ALL volumes from ALL projects
    if (allRawVolumes.length > 0) {
        console.log(`[main.ts] 🌍 GLOBAL NORMALIZATION: Processing ${allRawVolumes.length} volumes from all projects`);

        // Collect ALL possible properties from ALL volumes across ALL projects
        const allPossibleVolumeProps = new Set<string>();
        allRawVolumes.forEach((volume, index) => {
            Object.keys(volume).forEach(prop => allPossibleVolumeProps.add(prop));
        });

        const sortedAllVolumeProps = Array.from(allPossibleVolumeProps).sort();
        console.log(`[main.ts] 🔧 Found ${sortedAllVolumeProps.length} unique properties across ALL volume projects`);

        // Normalize ALL volumes to have the same properties
        console.log(`[main.ts] 🔄 Normalizing ${allRawVolumes.length} volumes...`);
        const normalizedAllVolumes = allRawVolumes.map((volume, index) => {
            const normalizedVolume: Record<string, any> = {};
            sortedAllVolumeProps.forEach(prop => {
                // Preserve values when available, otherwise use appropriate defaults
                if (volume[prop] !== undefined) {
                    normalizedVolume[prop] = volume[prop];
            } else {
                    // Use appropriate defaults based on property name
                    if (prop === 'size' || prop.includes('_size') || prop.includes('_count')) {
                        normalizedVolume[prop] = 0; // Numeric fields default to 0
        } else {
                        normalizedVolume[prop] = ''; // String fields default to empty string
                    }
                }
            });
            if (index % 500 === 0 && index > 0) {
                console.log(`[main.ts] ✅ Normalized ${index + 1}/${allRawVolumes.length} volumes`);
        }
            return normalizedVolume;
        });

        // Verify ALL volumes now have identical property counts
        const expectedVolumePropCount = sortedAllVolumeProps.length;
        let allVolumeConsistent = true;
        normalizedAllVolumes.forEach((volume, index) => {
            const currentProps = Object.keys(volume).length;
            if (currentProps !== expectedVolumePropCount) {
                console.log(`[main.ts] 🚨 GLOBAL VOLUME INCONSISTENCY! Volume ${index} has ${currentProps} props, expected ${expectedVolumePropCount}`);
                allVolumeConsistent = false;
            }
        });

        if (allVolumeConsistent) {
            console.log(`[main.ts] ✅ GLOBAL VOLUME NORMALIZATION SUCCESS: All ${normalizedAllVolumes.length} volumes have exactly ${expectedVolumePropCount} properties`);
            } else {
            console.log(`[main.ts] ❌ GLOBAL VOLUME NORMALIZATION FAILED: Volumes still have inconsistent property counts`);
        }

        allFlattenedVolumes.push(...normalizedAllVolumes);
    }

    if (allFlattenedServers.length > 0 || allFlattenedVolumes.length > 0) {
        console.log(`[main.ts] 📊 Creating Excel report...`);

        // Create output directory if it doesn't exist
        const outputDir = path.join(process.cwd(), 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        
        // Create a new workbook
        const workbook = new ExcelJS.Workbook();
        
        // Add servers worksheet
        if (allFlattenedServers.length > 0) {
            console.log(`[main.ts] [excel] Creating servers worksheet with ${Object.keys(allFlattenedServers[0]).length} columns for ${allFlattenedServers.length} servers`);

            const serversSheet = workbook.addWorksheet('Servers');
            const headers = Object.keys(allFlattenedServers[0]);

            // Build table columns config
            const tableColumns = headers.map(header => ({
                name: header,
                filterButton: true,
            }));

            // Create named table for servers
            const serversTable = serversSheet.addTable({
                name: 'servers_table',
                ref: 'A1',
                headerRow: true,
                style: {
                    theme: 'TableStyleLight15',
                    showFirstColumn: true,
                    showLastColumn: true,
                    showRowStripes: true,
                    showColumnStripes: false
                },
                columns: tableColumns,
                rows: []
            });

            // Add data rows to the table
            console.log(`[main.ts] [excel] [servers] Adding ${allFlattenedServers.length} rows to table...`);
            allFlattenedServers.forEach((server, index) => {
                const values = Object.values(server);

                if (values.length !== tableColumns.length) {
                    console.log(`[main.ts] [excel] [servers] 🚨 COLUMN MISMATCH! Row ${index}: ${values.length} values vs ${tableColumns.length} columns`);
                }

                serversTable.addRow(values);

                if (index % 1000 === 0 && index > 0) {
                    console.log(`[main.ts] [excel] [servers] ✅ Added ${index + 1}/${allFlattenedServers.length} rows`);
                }
            });

            console.log(`[main.ts] [excel] [servers] 🔄 Committing table...`);
            serversTable.commit();
            console.log(`[main.ts] [excel] [servers] ✅ Table created successfully!`);

            // Now style the header row after table is committed
            const headerRow = serversSheet.getRow(1);
            headerRow.font = { bold: true };
            headerRow.alignment = { horizontal: 'center' };

            // Auto-fit columns
            serversSheet.columns.forEach(column => {
                if (column.header) {
                    column.width = Math.max(column.header.toString().length + 2, 15);
                }
            });

            // Add servers summary sheet 
            const serversSummarySheet = workbook.addWorksheet('Servers Summary');
            
            // Get unique project names and statuses
            const uniqueProjects = [...new Set(allFlattenedServers.map(s => s.project_name))];
            const uniqueStatuses = [...new Set(allFlattenedServers.map(s => s.status))];
            
            console.log(`[main.ts] [excel] [servers_summary] Found ${uniqueProjects.length} projects and ${uniqueStatuses.length} statuses: ${uniqueStatuses.join(', ')}`);

            // Create status summary table data
            const statusSummaryData: any[][] = [];
            uniqueProjects.forEach((project, index) => {
                const rowData: any[] = [project];
                uniqueStatuses.forEach((status, statusIndex) => {
                    // Add simple COUNTIFS formula using table name references
                    rowData.push({
                        formula: `COUNTIFS(servers_table[project_name],"${project}",servers_table[status],"${status}")`
                    });
                });
                statusSummaryData.push(rowData);
            });

            // Create status summary table
            const statusTableColumns = [
                { name: 'Project Name', filterButton: true },
                ...uniqueStatuses.map(status => ({ name: status, filterButton: true }))
            ];

            createTable({
                worksheet: serversSummarySheet,
                name: 'servers_status_summary',
                ref: 'A1',
                columns: statusTableColumns,
                rows: statusSummaryData,
            });

            console.log(`[main.ts] [excel] [servers_summary] ✅ Status summary table created!`);

            // Add compute power summary table (starting after status table + some spacing)
            const computeStartRow = uniqueProjects.length + 5; // Status table + header + totals + spacing

            const computeSummaryData: any[][] = [];
            uniqueProjects.forEach((project) => {
                computeSummaryData.push([
                    project,
                    { formula: `SUMIF(servers_table[project_name],"${project}",servers_table[flavor_vcpus])` },
                    { formula: `SUMIF(servers_table[project_name],"${project}",servers_table[flavor_ram])` }
                ]);
            });

            const computeTableColumns = [
                { name: 'Project Name', filterButton: true },
                { name: 'Total vCPUs', filterButton: true },
                { name: 'Total RAM (MB)', filterButton: true }
            ];

            createTable({
                worksheet: serversSummarySheet,
                name: 'servers_compute_summary',
                ref: `A${computeStartRow}`,
                columns: computeTableColumns,
                rows: computeSummaryData,
            });

            console.log(`[main.ts] [excel] [servers_summary] ✅ Compute summary table created!`);
        }
        
        // Add volumes worksheet
        if (allFlattenedVolumes.length > 0) {
            console.log(`[main.ts] [excel] Creating volumes worksheet with ${Object.keys(allFlattenedVolumes[0]).length} columns for ${allFlattenedVolumes.length} volumes`);

            const volumesSheet = workbook.addWorksheet('Volumes');
            const headers = Object.keys(allFlattenedVolumes[0]);

            // Build table columns config
            const tableColumns = headers.map(header => ({
                name: header,
                filterButton: true,
            }));

            // Create named table for volumes
            const volumesTable = createTable({
                worksheet: volumesSheet,
                name: 'volumes_table',
                ref: 'A1',
                columns: tableColumns,
                rows: [], // No data rows yet
            });

            // Add data rows to the table
            console.log(`[main.ts] [excel] [volumes] Adding ${allFlattenedVolumes.length} rows to table...`);
            allFlattenedVolumes.forEach((volume, index) => {
                const values = Object.values(volume);
                volumesTable.addRow(values);

                if (index % 1000 === 0 && index > 0) {
                    console.log(`[main.ts] [excel] [volumes] ✅ Added ${index + 1}/${allFlattenedVolumes.length} rows`);
                }
            });

            // Commit the table changes
            console.log(`[main.ts] [excel] [volumes] 🔄 Committing table...`);
            volumesTable.commit();
            console.log(`[main.ts] [excel] [volumes] ✅ Table created successfully!`);

            // Now style the header row after table is committed
            const headerRow = volumesSheet.getRow(1);
            headerRow.font = { bold: true };
            headerRow.alignment = { horizontal: 'center' };

            // Auto-fit columns
            volumesSheet.columns.forEach(column => {
                if (column.header) {
                    column.width = Math.max(column.header.toString().length + 2, 15);
                }
            });

            // Add volumes summary sheet
            const volumesSummarySheet = workbook.addWorksheet('Volumes Summary');
            
            // Get unique projects, volume types, and volume statuses
            const uniqueVolumeProjects = [...new Set(allFlattenedVolumes.map(v => v.project_name))];
            const uniqueVolumeTypes = [...new Set(allFlattenedVolumes.map(v => v.volumeType))].filter(type => type && type !== '');
            const uniqueVolumeStatuses = [...new Set(allFlattenedVolumes.map(v => v.status))].filter(status => status && status !== '');
            
            console.log(`[main.ts] [excel] [volumes_summary] Found ${uniqueVolumeProjects.length} projects, ${uniqueVolumeTypes.length} volume types: ${uniqueVolumeTypes.join(', ')}`);
            console.log(`[main.ts] [excel] [volumes_summary] Found ${uniqueVolumeStatuses.length} volume statuses: ${uniqueVolumeStatuses.join(', ')}`);

        
            // Create volume TYPE summary table data  
            const volumeTypeSummaryData: any[][] = [];
            uniqueVolumeProjects.forEach((project) => {
                const rowData: any[] = [project];
                uniqueVolumeTypes.forEach((volumeType) => {
                    // Add formula to count volumes for each volume type
                    rowData.push({
                        formula: `COUNTIFS(volumes_table[project_name],"${project}",volumes_table[volumeType],"${volumeType}")`
                    });
                });
                volumeTypeSummaryData.push(rowData);
            });

            // Create volume TYPE summary table
            const volumeTypeTableColumns = [
                { name: 'Project Name', filterButton: true },
                ...uniqueVolumeTypes.map(type => ({ name: type || 'Unknown', filterButton: true }))
            ];

            createTable({
                worksheet: volumesSummarySheet,
                name: 'volumes_type_summary',
                ref: 'A1',
                columns: volumeTypeTableColumns,
                rows: volumeTypeSummaryData,
            });

            console.log(`[main.ts] [excel] [volumes_summary] ✅ Volume type summary table created!`);

            // Create volume STATUS summary table (starting after type table + some spacing)
            const volumeStatusStartRow = uniqueVolumeProjects.length + 5; // Type table + header + totals + spacing
            
            const volumeStatusSummaryData: any[][] = [];
            uniqueVolumeProjects.forEach((project) => {
                const rowData: any[] = [project];
                uniqueVolumeStatuses.forEach((volumeStatus) => {
                    // Add formula to count volumes for each volume status
                    rowData.push({
                        formula: `COUNTIFS(volumes_table[project_name],"${project}",volumes_table[status],"${volumeStatus}")`
                    });
                });
                volumeStatusSummaryData.push(rowData);
            });

            // Create volume STATUS summary table
            const volumeStatusTableColumns = [
                { name: 'Project Name', filterButton: true },
                ...uniqueVolumeStatuses.map(status => ({ name: status || 'Unknown', filterButton: true }))
            ];

            createTable({
                worksheet: volumesSummarySheet,
                name: 'volumes_status_summary',
                ref: `A${volumeStatusStartRow}`,
                columns: volumeStatusTableColumns,
                rows: volumeStatusSummaryData,
            });

            console.log(`[main.ts] [excel] [volumes_summary] ✅ Volume status summary table created!`);
        }
        
        // Write to file with unique timestamp
        const timestamp = new Date().toISOString().replace(/[-:Z]/g, '').replace(/\./g, '');
        const outputPath = path.join(outputDir, `${timestamp}-openstack-resources.xlsx`);

        console.log(`[main.ts] [excel] 💾 Writing Excel file to: ${outputPath}`);

        // Determine final output path and write file
        let finalOutputPath: string;

        // Check if file already exists (shouldn't happen but let's be safe)
        if (fs.existsSync(outputPath)) {
            console.log(`[main.ts] [excel] ⚠️ File already exists, adding random suffix...`);
            const randomSuffix = Math.random().toString(36).substring(7);
            const baseDir = path.dirname(outputPath);
            const baseName = path.basename(outputPath, '.xlsx');
            finalOutputPath = path.join(baseDir, `${baseName}-${randomSuffix}.xlsx`);
            await workbook.xlsx.writeFile(finalOutputPath);
            console.log(`[main.ts] ✅ XLSX generated successfully at: ${finalOutputPath}`);
        } else {
            finalOutputPath = outputPath;
            await workbook.xlsx.writeFile(finalOutputPath);
            console.log(`[main.ts] ✅ XLSX generated successfully at: ${finalOutputPath}`);
        }

        // Open Excel file automatically (cross-platform)
        console.log(`[main.ts] 🚀 Opening Excel file: ${finalOutputPath}`);

        try {
            let command: string;
            if (process.platform === 'win32') {
                command = `start excel "${finalOutputPath}"`;
            } else if (process.platform === 'darwin') {
                command = `open "${finalOutputPath}"`;
            } else {
                command = `xdg-open "${finalOutputPath}"`;
            }

            // Use promisified exec to wait for completion
            const { exec: execPromise } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(execPromise);

            await execAsync(command);
            console.log(`[main.ts] ✅ Excel file opened successfully`);
        } catch (error: any) {
            console.error(`[main.ts] ❌ Failed to open Excel file: ${error.message}`);
            console.log(`[main.ts] You can manually open the file at: ${finalOutputPath}`);
        }

        // Give a moment for the command to execute before exiting
        setTimeout(() => {
            console.log(`[main.ts] ✅ Process completed successfully`);
        process.exit(0);
        }, 1000);
    } else {
        console.log('[main.ts] ❌ No resources found');
        process.exit(1); 
    }

}


(async () => {
    await main();
    console.log('[main.ts] ✅ Process completed successfully');
    process.exit(0);
})();