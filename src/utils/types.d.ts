// OpenStack API Response Types

// Link structure used in multiple responses
interface Link {
    href: string;
    rel: string;
}

// Token is just a string
export type OpenStackToken = string;

// Projects API Response
export interface ProjectsResponse {
    links: {
        self: string;
        previous: string | null;
        next: string | null;
    };
    projects: Project[];
}

export interface Project {
    is_domain: boolean;
    description: string;
    links: {
        self: string;
    };
    tags: string[];
    enabled: boolean;
    id: string;
    parent_id: string;
    domain_id: string;
    name: string;
}

// Flavors API Response
export interface FlavorsResponse {
    flavors: Flavor[];
}

export interface Flavor {
    name: string;
    links: Link[];
    ram: number;
    "OS-FLV-DISABLED:disabled": boolean;
    vcpus: number;
    swap: string;
    "os-flavor-access:is_public": boolean;
    rxtx_factor: number;
    "OS-FLV-EXT-DATA:ephemeral": number;
    disk: number;
    id: string;
}

// Servers API Response
export interface ServersResponse {
    servers: Server[];
}

export interface Server {
    "OS-EXT-STS:task_state": string | null;
    addresses: Record<string, NetworkAddress[]>;
    links: Link[];
    image: string;
    "OS-EXT-STS:vm_state": string;
    "OS-SRV-USG:launched_at": string;
    flavor: {
        id: string;
        links: Link[];
    };
    id: string;
    security_groups: SecurityGroup[];
    user_id: string;
    "OS-DCF:diskConfig": string;
    accessIPv4: string;
    accessIPv6: string;
    progress?: number;
    "OS-EXT-STS:power_state": number;
    "OS-EXT-AZ:availability_zone": string;
    config_drive: string;
    status: string;
    updated: string;
    hostId: string;
    "OS-SRV-USG:terminated_at": string | null;
    key_name: string | null;
    name: string;
    created: string;
    tenant_id: string;
    "os-extended-volumes:volumes_attached": VolumeAttachment[];
    metadata: Record<string, any>;
}

interface NetworkAddress {
    "OS-EXT-IPS-MAC:mac_addr": string;
    version: number;
    addr: string;
    "OS-EXT-IPS:type": string;
}

interface SecurityGroup {
    name: string;
}

interface VolumeAttachment {
    id: string;
}

// Volumes API Response
export interface VolumesResponse {
    volumes: Volume[];
}

export interface Volume {
    status: string;
    displayDescription: string | null;
    availabilityZone: string;
    displayName: string;
    attachments: VolumeAttachmentDetail[];
    volumeType: string;
    snapshotId: string | null;
    metadata: Record<string, any>;
    id: string;
    createdAt: string;
    size: number;
}

interface VolumeAttachmentDetail {
    device?: string;
    serverId?: string;
    id?: string;
    volumeId?: string;
}

// Configuration Types
export interface Endpoint {
    domain: string;
    endpoint: string;
    initial_project: string;
}

// Flattened data types for Excel export
export interface FlattenedServer extends Record<string, string> {
    domain: string;
    project_name: string;
    flavor_vcpus: string;
    flavor_ram: string;
    flavor_disk: string;
    flavor_name: string;
    status: string;
    name: string;
    id: string;
    created: string;
    updated: string;
    // ... other flattened fields
}

export interface FlattenedVolume extends Record<string, string> {
    domain: string;
    project_name: string;
    status: string;
    name: string;
    id: string;
    created: string;
    updated: string;
    volume_type: string;
    size: string;
    // ... other flattened fields
}