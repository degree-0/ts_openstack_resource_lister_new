import ky, { Options } from 'ky';
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { writeFile } from "node:fs";
import { Buffer } from "node:buffer";

import dotenv from 'dotenv';
import { Server } from './types';
dotenv.config();

// Parse the base64 into JSON data
const base64Locations = process.env.BV_TENANTS ?? '';
const decodedData = Buffer.from(base64Locations, 'base64').toString('utf-8');
const locations = JSON.parse(decodedData);

const authenticate = async (username: string, password: string, base_url: string, location: string, tenant: string) => {
    console.log(`Authenticating ${username} in ${location} with tenant ${tenant}`);
    const response = await ky.post(`${base_url}/identity/v3/auth/tokens`, {
        json: {
            "auth": {
                "identity": {
                    "methods": ["password"],
                    "password": {
                        "user": {
                            "domain": {
                                "name": location
                            },
                            "name": username,
                            "password": password
                        }
                    }
                },
                "scope": {
                    "project": {
                        "domain": {
                            "name": location
                        },
                        "name": tenant
                    }
                }

            }
        }
    });
  
    return response.headers.get('X-Subject-Token');
}

(async () => {

    const csvConfig = mkConfig({ useKeysAsHeaders: true });
    let data: any = [];

    for(const location of locations){
        for(const tenant of location.tenants){
            const token = await authenticate(process.env.username|| "", process.env.password|| "", location.base_url, location.name, tenant);
            console.log(token);
            // get resources
            const options: Options = {
                headers:{
                    'X-Auth-Token': token || ""
                },
                searchParams:{
                    limit: 100
                }
            }
            const servers: any = await ky.get(`${location.base_url}/compute/v2.1/servers/detail`, options).json();
            console.log(JSON.stringify(servers.servers[0],null,4));
            servers.servers.forEach((server: Server) => {
                data.push({
                    "Name": server.name,
                    "Status": server.status,
                    "Created": server.created,
                    "Updated": server.updated,
                    "HostId": server.hostId,
                    "TenantId": server.tenant_id,
                    "KeyName": server.key_name,
                    "Image": server.image,
                    "Flavor": server.flavor.id,
                    "SecurityGroups": JSON.stringify(server.security_groups),
                    "Metadata": JSON.stringify(server.metadata),



                    "Addresses": JSON.stringify(server.addresses),
                   // "Tenant": tenant,
                });
            });

            // exit the loop
            break;

            
        }

        // exit the loop
        break;

    }

    const csv = generateCsv(csvConfig)(data);
    const filename = `${csvConfig.filename}.csv`;
    const csvBuffer = new Uint8Array(Buffer.from(asString(csv)));

    writeFile(filename, csvBuffer, (err) => {
        if (err) throw err;
        console.log("file saved: ", filename);
    });
      
})();