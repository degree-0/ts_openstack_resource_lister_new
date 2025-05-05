import { mkConfig, generateCsv, asString } from "export-to-csv";
import ky from 'ky';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';


dotenv.config();

const endpoints: string[] = process.env.OS_ENDPOINTS?.split(',') || [];
const username: string = process.env.OS_USERNAME || '';
const password: string = process.env.OS_PASSWORD || '';
const projectIds: string[] = JSON.parse(process.env.OS_PROJECTS_IDS || '[]');

// function to extract jed1 from api-jed-vdc string for example
function extractDomain(endpoint: string) {
    return endpoint.split('-')[1];
}


// Promisified version of getProjectToken
const getProjectToken = async (endpoint: string, username: string, password: string, projectId: string) => {
    console.log(`getting project token for projectId ${projectId}`);
    const keystone_url: any = `${endpoint}/identity/v3/auth/tokens`;
    const domain = extractDomain(endpoint);

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

const getProjects = async (endpoint: string, projectToken: string) => {
    const projects_url: any = `${endpoint}/identity/v3/auth/projects`;
    const json = await ky.get(projects_url, { headers: { 'X-Auth-Token': projectToken } }).json();
    return json;
}

const getServers = async (endpoint: string, projectToken: string) => {
    try {
        const servers_url: any = `${endpoint}/compute/v2.1/servers/detail`;
        const json = await ky.get(servers_url, { headers: { 'X-Auth-Token': projectToken } }).json();
        return json;
    } catch (error) {
        console.error(error.response.body);
    }
}

const getFlavors = async (endpoint: string, projectToken: string) => {
    const flavors_url: any = `${endpoint}/compute/v2.1/flavors/detail`;
    const json = await ky.get(flavors_url, { headers: { 'X-Auth-Token': projectToken } }).json();
    return json;
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

(async () => {
    const allFlattenedServers: Record<string, string>[] = [];
    
    for (const endpoint of endpoints) {
        const domain = extractDomain(endpoint);
        const generalProjectToken = await getProjectToken(endpoint, username, password, projectIds[domain][0]);
        if (!generalProjectToken) {
            throw new Error('Failed to get project token');
        }
        const projects: any = await getProjects(endpoint, generalProjectToken);
        if (!projects) {
            throw new Error('Failed to get projects');
        }
        
        for (const project of projects.projects) {
            const projectToken = await getProjectToken(endpoint, username, password, project.name);
            if (!projectToken) {
                throw new Error('Failed to get project token');
            }
            
            // Get flavors first
            const flavors: any = await getFlavors(endpoint, projectToken);
            
            // List servers
            const servers: any = await getServers(endpoint, projectToken);
            if (servers.servers.length > 0) {
                const flattenedServers = servers.servers.map((server: any) => 
                    flattenServer(server, flavors.flavors, domain, project.name)
                );
                allFlattenedServers.push(...flattenedServers);
            }
        }
    }

    if (allFlattenedServers.length > 0) {
        const csvConfig = mkConfig({ 
            useKeysAsHeaders: true,
            filename: 'openstack-servers'
        });
        const csv = generateCsv(csvConfig)(allFlattenedServers);
        const csvString = asString(csv);
        
        // Create output directory if it doesn't exist
        const outputDir = path.join(process.cwd(), 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        
        // Write CSV to file
        const outputPath = path.join(outputDir, 'openstack-servers.csv');
        fs.writeFileSync(outputPath, csvString);
        console.log(`CSV generated successfully at: ${outputPath}`);
        process.exit(0);
    } else {
        console.log('No servers found');
        process.exit(1);
    }
})();
