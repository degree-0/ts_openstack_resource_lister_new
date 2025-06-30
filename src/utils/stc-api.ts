import ky from "ky";
import { OpenStackToken, ProjectsResponse, ServersResponse, FlavorsResponse, VolumesResponse, Server, Flavor, Volume } from "./types";

// HTTP request configuration with timeout and retry
const requestConfig = {
    timeout: 60000, // 60 seconds timeout
    retry: 2, // Retry failed requests twice
    throwHttpErrors: false
};

// Promisified version of getProjectToken
export const getProjectToken = async (endpoint: string, domain: string, username: string, password: string, projectId: string): Promise<OpenStackToken | undefined> => {
    console.log(`getting project token for projectId ${projectId}`);
    const keystone_url = `${endpoint}/identity/v3/auth/tokens`;

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
        const response = await ky.post(keystone_url, {
            json: payload,
            ...requestConfig
        });

        if (!response.ok) {
            console.error(`Failed to get token. Status: ${response.status}`);
            return undefined;
        }

        return response.headers.get('x-subject-token') as OpenStackToken;
    } catch (error) {
        console.error('Error getting project token:', error);
        return undefined;
    }
}


export const getProjects = async (endpoint: string, token: OpenStackToken): Promise<ProjectsResponse> => {
    const projects_url = `${endpoint}/identity/v3/auth/projects`;
    try {
        const response = await ky.get(projects_url, {
            headers: { 'X-Auth-Token': token },
            ...requestConfig
        });

        if (!response.ok) {
            console.error(`Failed to get projects. Status: ${response.status}`);
            throw new Error(`Failed to get projects: ${response.status}`);
        }

        const json = await response.json() as ProjectsResponse;
        console.log(`Found ${json.projects.length} projects in ${endpoint}`);
        return json;
    } catch (error) {
        console.error('Error getting projects:', error);
        throw error;
    }
}

export const getServers = async (endpoint: string, token: OpenStackToken): Promise<ServersResponse | undefined> => {
    try {
        const servers_url = `${endpoint}/compute/v2.1/servers/detail`;
        const response = await ky.get(servers_url, {
            headers: { 'X-Auth-Token': token },
            ...requestConfig
        });

        if (!response.ok) {
            console.error(`Failed to get servers. Status: ${response.status}`);
            return undefined;
        }

        const json = await response.json() as ServersResponse;
        return json;
    } catch (error) {
        console.error('Error getting servers:', error);
        return undefined;
    }
}

export const getFlavors = async (endpoint: string, token: OpenStackToken): Promise<FlavorsResponse> => {
    try {
        const flavors_url = `${endpoint}/compute/v2.1/flavors/detail`;
        const response = await ky.get(flavors_url, {
            headers: { 'X-Auth-Token': token },
            ...requestConfig
        });

        if (!response.ok) {
            console.error(`Failed to get flavors. Status: ${response.status}`);
            throw new Error(`Failed to get flavors: ${response.status}`);
        }

        const json = await response.json() as FlavorsResponse;
        return json;
    } catch (error) {
        console.error('Error getting flavors:', error);
        throw error;
    }
}

export const getVolumes = async (endpoint: string, token: OpenStackToken): Promise<VolumesResponse> => {
    try {
        const volumes_url = `${endpoint}/compute/v2.1/os-volumes/detail`;
        console.log(`[${endpoint}] Fetching volumes from: ${volumes_url} (timeout: ${requestConfig.timeout}ms)`);
        const response = await ky.get(volumes_url, {
            headers: { 'X-Auth-Token': token },
            ...requestConfig
        });

        if (!response.ok) {
            console.error(`Failed to fetch volumes. Status: ${response.status}`);
            console.error(`Response: ${await response.text()}`);
            return { volumes: [] };
        }

        const json = await response.json() as VolumesResponse;
        console.log(`[${endpoint}] Successfully fetched ${json.volumes.length} volumes`);
        return json;
    } catch (error) {
        console.error('Error fetching volumes:', error);
        if (error.name === 'TimeoutError') {
            console.error(`Request timed out after ${requestConfig.timeout}ms. You may need to increase the timeout further.`);
        }
        return { volumes: [] };
    }
}


export const flattenServer = (server: Server, flavors: Flavor[], domain: string, projectName: string): Record<string, any> => {
    const flattened: Record<string, any> = {};

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
                        flattened[`${key}_ram`] = Number(flavor.ram); // Store as number
                        flattened[`${key}_vcpus`] = Number(flavor.vcpus); // Store as number
                        flattened[`${key}_disk`] = Number(flavor.disk); // Store as number
                    } else {
                        // Ensure all servers have the same columns even if flavor is not found
                        flattened[`${key}_name`] = '';
                        flattened[`${key}_ram`] = 0;
                        flattened[`${key}_vcpus`] = 0;
                        flattened[`${key}_disk`] = 0;
                    }
                } else {
                    flattened[key] = JSON.stringify(value);
                }
            }
        } else {
            // Handle special numeric fields
            if (key === 'OS-EXT-STS:power_state') {
                flattened[key] = Number(value);
            } else {
                flattened[key] = String(value);
            }
        }
    }

    return flattened;
};

export const flattenVolume = (volume: Volume, domain: string, projectName: string): Record<string, any> => {
    const flattened: Record<string, any> = {};

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
                // Handle arrays - special handling for attachments
                if (key === 'attachments') {
                    // Flatten each attachment object
                    value.forEach((attachment: any, index: number) => {
                        if (typeof attachment === 'object' && attachment !== null) {
                            Object.entries(attachment).forEach(([attachKey, attachValue]) => {
                                flattened[`${key}_${index}_${attachKey}`] = String(attachValue || '');
                            });
                        } else {
                            flattened[`${key}_${index}`] = String(attachment || '');
                        }
                    });
                } else {
                    // For other arrays, join as semicolon-separated values
                    flattened[key] = value.map((item: any) => {
                        if (typeof item === 'object' && item !== null) {
                            return JSON.stringify(item);
                        }
                        return String(item || '');
                    }).join(';');
                }
            } else {
                // Handle objects - special handling for metadata and other JSON objects
                if (key === 'metadata') {
                    // Flatten metadata properties
                    Object.entries(value).forEach(([metaKey, metaValue]) => {
                        flattened[`${key}_${metaKey}`] = String(metaValue || '');
                    });
                } else {
                    // For other objects, try to flatten them if they look like structured data
                    try {
                        const objEntries = Object.entries(value);
                        if (objEntries.length > 0 && objEntries.length <= 10) { // Only flatten reasonably sized objects
                            objEntries.forEach(([objKey, objValue]) => {
                                flattened[`${key}_${objKey}`] = String(objValue || '');
                            });
                        } else {
                            // Too complex, just stringify
                            flattened[key] = JSON.stringify(value);
                        }
                    } catch (error) {
                        // Fallback to stringify if flattening fails
                        flattened[key] = JSON.stringify(value);
                    }
                }
            }
        } else {
            // Handle special numeric fields for volumes
            if (key === 'size') {
                flattened[key] = Number(value);
            } else {
                flattened[key] = String(value);
            }
        }
    }

    return flattened;
};