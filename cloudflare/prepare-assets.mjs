import {mkdir,copyFile} from 'node:fs/promises';
const output=new URL('./public/',import.meta.url);
await mkdir(output,{recursive:true});
// Publish only the client UI, never device profiles or the legacy server UI.
for(const name of ['call.html','call-client.js','friends.html','friends-client.js','local-profile.js','peer-profile.js']) await copyFile(new URL('../Vumiro.Client/WebServer/'+name,import.meta.url),new URL(name,output));
console.log('Prepared friends and call client assets.');
