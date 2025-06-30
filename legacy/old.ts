const servers = (data: any, project: string) => data.servers.map(server => ({
    id: server.id,
    name: server.name,
    status: server.status,
    task_state: server['OS-EXT-STS:task_state'],
    vm_state: server['OS-EXT-STS:vm_state'],
    addresses: JSON.stringify(server.addresses),
    launched_at: server['OS-SRV-USG:launched_at'],
    power_state: server['OS-EXT-STS:power_state'],
    updated: server.updated,
    created: server.created,
    tenant_id: server.tenant_id,
    metadata: JSON.stringify(server.metadata),
    location: location,
    project: project
  }));