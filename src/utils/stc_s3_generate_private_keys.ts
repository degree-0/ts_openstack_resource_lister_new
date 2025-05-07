import { mkConfig, generateCsv, asString } from 'export-to-csv';
import { writeFile } from 'node:fs';
import { Buffer } from 'node:buffer';
import dotenv from 'dotenv';

dotenv.config();

const getKeys = async (id: string, sessionData: string[]): Promise<any> => {
    console.log(`Getting keys for ${id} with session ${sessionData[0].split("HttpOnly")[0]}`);

    // Prepare the options for the fetch POST request
    const options:any = {
        method: 'POST',
        headers: {
            'Cookie': sessionData[0], // Use the first session data
        },
        credentials: 'include', // Include credentials (cookies)
    };

    try {
        // Make the POST request using fetch
        const response = await fetch(`${process.env.BV_BASE_URL}/create_key/${id}`, options);

        console.log('Getting Keys Request completed Successfully');

        // Parse the response as text
        const text = await response.text();

        // Optionally, log the headers
        const headers = response.headers;
        console.log('Response Headers:', Array.from(headers.entries()));

        // Parse the response as JSON (if applicable)
        const keys = JSON.parse(text);
        console.log('Keys retrieved:', keys);
        return keys;
    } catch (error: any) {
        console.error('Error fetching keys:', error.message);
        return null; // Return null in case of failure
    }
};

const s3Login = async (username: string, password: string, accId: string): Promise<string[] | null> => {
    console.log(`Logging in ${username} with account ${accId}`);

    // Prepare form data manually for fetch
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('acc_login_id', accId);

    const options:any = {
        method: 'POST',
        body: formData,
        credentials: 'include', // Include cookies
    };

    try {
        // Make the POST request using fetch
        const response = await fetch(`${process.env.BV_BASE_URL}/s3_login`, options);

        console.log('Login Request completed Successfully');
        const headers = Array.from(response.headers.entries());
        console.log('Response Headers:', headers);

        // Extract cookies from the headers
        const cookies = response.headers.get('set-cookie');
        console.log('Cookies:', cookies);

        if (cookies) {
            return [cookies]; // Return cookies in an array (to match the original code's type)
        }

        return null; // Return null if no session cookie found
    } catch (error: any) {
        console.error('Error during login:', error.message);
        return null;
    }
};

const main = async () => {
    // IDs for the accounts to get keys for
    const ids = [
        "1XXXXXXXXXXX030",
    ];

    const csvConfig = mkConfig({ useKeysAsHeaders: true });
    let data: any = [];

    for (const id of ids) {
        const session_cookie = await s3Login(process.env.username || "", process.env.password || "", id);
        if (session_cookie) {
            const keys = await getKeys(id, session_cookie);
            if (keys) {
                data.push({ id: id, accessKey: keys.accessKey, secretAccessKey: keys.secretAccessKey });
            }
        } else {
            console.log(`Could not get session for ${id}`);
        }
    }

    const csv = generateCsv(csvConfig)(data);
    const filename = `${csvConfig.filename}-keys.csv`;
    const csvBuffer = new Uint8Array(Buffer.from(asString(csv)));

    writeFile(filename, csvBuffer, (err) => {
        if (err) throw err;
        console.log('File saved:', filename);
    });
};

main();
