export interface Server {
    'OS-EXT-STS:task_state': null;
    addresses: { [key: string]: [any] };
    links: { href: string, rel: string }[];
    image: string;
    'OS-EXT-STS:vm_state': string;
    'OS-SRV-USG:launched_at': string;
    flavor: { id: string, links: { href: string }[] };
    id: string;
    security_groups: { name: string }[];
    user_id: string;
    'OS-DCF:diskConfig': string;
    accessIPv4: string;
    accessIPv6: string;
    progress: number;
    'OS-EXT-STS:power_state': number;
    'OS-EXT-AZ:availability_zone': string;
    config_drive: string;
    status: string;
    updated: string;
    hostId: string;
    'OS-SRV-USG:terminated_at': null;
    key_name: string;
    name: string;
    created: string;
    tenant_id: string;
    'os-extended-volumes:volumes_attached': { id: string }[];
    metadata: {
        depends_on: string;
        use_access_ip: string;
        ssh_user: string;
        kubespray_groups: string;
    }
}