import { mkConfig, generateCsv, asString } from "export-to-csv";
import ky from 'ky';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';


dotenv.config();

const base64_endpoints: string = process.env.OS_ENDPOINTS_TENANTS || '';
const decoded_endpoints: string = Buffer.from(base64_endpoints, 'base64').toString('utf-8');
const endpoints: Endpoint[] = JSON.parse(decoded_endpoints);
const username: string = process.env.OS_USERNAME || '';
const password: string = process.env.OS_PASSWORD || '';

type Endpoint = {
    domain: string;
    endpoint: string;
    initial_project: string;
}




// Promisified version of getProjectToken
const getProjectToken = async (endpoint: string, domain: string, username: string, password: string, projectId: string) => {
    console.log(`getting project token for projectId ${projectId}`);
    const keystone_url: any = `${endpoint}/identity/v3/auth/tokens`;

    const payload = {
        "auth": {
            "identity": {
                "methods": ["password"],
                "password": {
                    "user": {
                        "domain": {
                            "name": domain
                        },
                        "name": username,
                        "password": password
                    }
                }
            },
            "scope": {
                "project": {
                    "domain": {
                        "name": domain
                    },
                    "name": projectId
                }
            }
        }
    }
    try {
        const response = await ky.post(keystone_url, { json: payload });
        return response.headers.get('x-subject-token');
    } catch (error) {
        console.error(error);
    }


}

const getProjects = async (endpoint: string, token: string) => {
    const projects_url: any = `${endpoint}/identity/v3/auth/projects`;
    const json = await ky.get(projects_url, { headers: { 'X-Auth-Token': token } }).json();
    return json;
}

const getServers = async (endpoint: string, token: string) => {
    try {
        const servers_url: any = `${endpoint}/compute/v2.1/servers/detail`;
        const json = await ky.get(servers_url, { headers: { 'X-Auth-Token': token } }).json();
        return json;
    } catch (error) {
        console.error(error);
    }
}

const getFlavors = async (endpoint: string, token: string) => {
    const flavors_url: any = `${endpoint}/compute/v2.1/flavors/detail`;
    const json = await ky.get(flavors_url, { headers: { 'X-Auth-Token': token } }).json();
    return json;
}

const getVolumes = async (endpoint: string, token: string) => {
    try {
        const volumes_url: any = `${endpoint}/compute/v2.1/os-volumes/detail`;
        console.log(`Fetching volumes from: ${volumes_url}`);
        const response = await ky.get(volumes_url, { 
            headers: { 'X-Auth-Token': token },
            throwHttpErrors: false // Don't throw on HTTP errors
        });
        
        if (!response.ok) {
            console.error(`Failed to fetch volumes. Status: ${response.status}`);
            console.error(`Response: ${await response.text()}`);
            return { volumes: [] };
        }

        const json = await response.json();
        //console.log('Volumes response:', JSON.stringify(json, null, 2));
        return json;
    } catch (error) {
        console.error('Error fetching volumes:', error);
        return { volumes: [] };
    }
}

const flattenServer = (server: any, flavors: any[], domain: string, projectName: string): Record<string, string> => {
    const flattened: Record<string, string> = {};
    
    // Add domain and project info
    flattened['domain'] = domain;
    flattened['project_name'] = projectName;
    
    // Find matching flavor
    const flavor = flavors.find(f => f.id === server.flavor.id);
    
    // List of columns to exclude
    const excludedColumns = [
        'OS-EXT-STS:task_state',
        'addresses',
        'links',
        'flavor_id',
        'progress',
        'accessIPv4',
        'accessIPv6',
        'config_drive',
        'hostId',
        'OS-SRV-USG:terminated_at',
        'key_name',
        'tenant_id',
        'os-extended-volumes:volumes_attached',
        'metadata'
    ];
    
    for (const [key, value] of Object.entries(server)) {
        // Skip excluded columns
        if (excludedColumns.includes(key)) {
            continue;
        }
        
        if (value === null) {
            flattened[key] = '';
        } else if (typeof value === 'object') {
            if (Array.isArray(value)) {
                // Handle arrays (like security_groups)
                if (key === 'security_groups') {
                    flattened[key] = value.map((sg: any) => sg.name).join(';');
                } else {
                    flattened[key] = value.map((item: any) => JSON.stringify(item)).join(';');
                }
            } else {
                // Handle objects (like flavor)
                if (key === 'flavor') {
                    if (flavor) {
                        flattened[`${key}_name`] = flavor.name;
                        flattened[`${key}_ram`] = flavor.ram.toString();
                        flattened[`${key}_vcpus`] = flavor.vcpus.toString();
                        flattened[`${key}_disk`] = flavor.disk.toString();
                    }
                } else {
                    flattened[key] = JSON.stringify(value);
                }
            }
        } else {
            flattened[key] = String(value);
        }
    }
    
    return flattened;
};

const flattenVolume = (volume: any, domain: string, projectName: string): Record<string, string> => {
    const flattened: Record<string, string> = {};
    
    // Add domain and project info
    flattened['domain'] = domain;
    flattened['project_name'] = projectName;
    
    // List of columns to exclude
    const excludedColumns = [
        'links',
        'volume_image_metadata'
    ];
    
    for (const [key, value] of Object.entries(volume)) {
        // Skip excluded columns
        if (excludedColumns.includes(key)) {
            continue;
        }
        
        if (value === null) {
            flattened[key] = '';
        } else if (typeof value === 'object') {
            if (Array.isArray(value)) {
                flattened[key] = value.map((item: any) => JSON.stringify(item)).join(';');
            } else {
                flattened[key] = JSON.stringify(value);
            }
        } else {
            flattened[key] = String(value);
        }
    }
    
    return flattened;
};

(async () => {
    const allFlattenedServers: Record<string, string>[] = [];
    const allFlattenedVolumes: Record<string, string>[] = [];
    
    for (const endpoint of endpoints) {
        const generalProjectToken = await getProjectToken(endpoint.endpoint, endpoint.domain, username, password, endpoint.initial_project);
        if (!generalProjectToken) {
            throw new Error('Failed to get project token');
        }
        const projects: any = await getProjects(endpoint.endpoint, generalProjectToken);
        if (!projects) {
            throw new Error('Failed to get projects');
        }
        
        for (const project of projects.projects) {
            const projectToken = await getProjectToken(endpoint.endpoint, endpoint.domain, username, password, project.name);
            if (!projectToken) {
                throw new Error('Failed to get project token');
            }
            
            // Get flavors first
            const flavors: any = await getFlavors(endpoint.endpoint, projectToken);
            
            // List servers
            const servers: any = await getServers(endpoint.endpoint, projectToken);
            if (servers.servers.length > 0) {
                const flattenedServers = servers.servers.map((server: any) => 
                    flattenServer(server, flavors.flavors, endpoint.domain, project.name)
                );
                allFlattenedServers.push(...flattenedServers);
            }

            // List volumes
            const volumes: any = await getVolumes(endpoint.endpoint, projectToken);
            //console.log('Volumes data:', volumes);
            if (volumes?.volumes?.length > 0) {
                
                const flattenedVolumes = volumes.volumes.map((volume: any) => 
                    flattenVolume(volume, endpoint.domain, project.name)
                );
                allFlattenedVolumes.push(...flattenedVolumes);
            } else {
                console.log(`No volumes found for project ${project.name}`);
            }
        }
    }

    if (allFlattenedServers.length > 0 || allFlattenedVolumes.length > 0) {
        // Create output directory if it doesn't exist
        const outputDir = path.join(process.cwd(), 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        
        // Create a new workbook
        const workbook = new ExcelJS.Workbook();
        
        // Add servers worksheet
        if (allFlattenedServers.length > 0) {
            const serversSheet = workbook.addWorksheet('Servers');
            const headers = Object.keys(allFlattenedServers[0]);
            serversSheet.addRow(headers);
            allFlattenedServers.forEach(server => {
                serversSheet.addRow(Object.values(server));
            });

            // Create named table for servers
            console.log('creating table for servers');
            const serversTable = serversSheet.addTable({
                name: 'servers_table',
                ref: `A1`,
                headerRow: true,
                columns: headers.map(header => ({ 
                    name: header,
                    filterButton: true,

                    
                })),
                rows: allFlattenedServers.map(server => Object.values(server)),
                style: {
                    theme: 'TableStyleDark1',
                    showFirstColumn: true,
                    showLastColumn: true,
                    showRowStripes: true,
                    showColumnStripes: false
                }
            });

            // Add servers summary sheet 
            const serversSummarySheet = workbook.addWorksheet('Servers Summary');
            
            // Get unique project names and statuses
            const uniqueProjects = [...new Set(allFlattenedServers.map(s => s.project_name))];
            const uniqueStatuses = [...new Set(allFlattenedServers.map(s => s.status))];
            
            // Create status summary table
            serversSummarySheet.addRow(['Project Name', ...uniqueStatuses]);
            uniqueProjects.forEach((project, index) => {
                const row = [project];
                uniqueStatuses.forEach(status => {
                    row.push(`=COUNTIFS(servers_table[project_name],$A${index + 2},servers_table[status],B$1)`);
                });
                serversSummarySheet.addRow(row);
            });

            // Add compute power summary
            serversSummarySheet.addRow([]); // Empty row for spacing
            serversSummarySheet.addRow(['Project Name', 'Total vCPUs', 'Total RAM (MB)']);
            uniqueProjects.forEach((project, index) => {
                serversSummarySheet.addRow([
                    project,
                    `=SUMIFS(servers_table[flavor_vcpus],servers_table[project_name],$A${index + uniqueStatuses.length + 4})`,
                    `=SUMIFS(servers_table[flavor_ram],servers_table[project_name],$A${index + uniqueStatuses.length + 4})`
                ]);
            });
        }
        
        // Add volumes worksheet
        if (allFlattenedVolumes.length > 0) {
            const volumesSheet = workbook.addWorksheet('Volumes');
            const headers = Object.keys(allFlattenedVolumes[0]);
            volumesSheet.addRow(headers);
            allFlattenedVolumes.forEach(volume => {
                volumesSheet.addRow(Object.values(volume));
            });

            // Create named table for volumes
            console.log('creating table for volumes');
            const volumesTable = volumesSheet.addTable({
                name: 'volumes_table',
                ref: `A1`,
                columns: headers.map(header => ({ 
                    name: header,
                    filterButton: true,
                    
                })),
                rows: allFlattenedVolumes.map(volume => Object.values(volume)),
                style: {
                    theme: 'TableStyleDark1',
                    showFirstColumn: true,
                    showLastColumn: true,
                    showRowStripes: true,
                    showColumnStripes: false
                }
            });

            // Add volumes summary sheet
            const volumesSummarySheet = workbook.addWorksheet('Volumes Summary');
            
            // Get unique volume types and statuses
            const uniqueVolumeTypes = [...new Set(allFlattenedVolumes.map(v => v.volume_type))];
            const uniqueStatuses = [...new Set(allFlattenedVolumes.map(v => v.status))];
            
            // Create volume type summary table
            volumesSummarySheet.addRow(['Volume Type', ...uniqueStatuses]);
            uniqueVolumeTypes.forEach((type, index) => {
                const row = [type];
                uniqueStatuses.forEach(status => {
                    row.push(`=SUMIFS(volumes_table[size],volumes_table[volume_type],$A${index + 2},volumes_table[status],B$1)`);
                });
                volumesSummarySheet.addRow(row);
            });
        }
        
        // Write to file
        const timestamp = new Date().toISOString().replace(/[-:Z]/g, '');
        const outputPath = path.join(outputDir, `${timestamp}-openstack-resources.xlsx`);
        await workbook.xlsx.writeFile(outputPath);
        console.log(`XLSX generated successfully at: ${outputPath}`);
        process.exit(0);
    } else {
        console.log('No resources found');
        process.exit(1); 
    }
})();
