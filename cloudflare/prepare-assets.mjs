import {mkdir,copyFile} from 'node:fs/promises';
const output=new URL('./public/',import.meta.url);
await mkdir(output,{recursive:true});
// Publish only the client UI, never device profiles or the legacy server UI.
for(const name of ['call.html','call-client.js','stream-mosaic.js','chat-pane.js','chat-scrollbar.js','friends.html','auth.html','controller-mapping.js', 'gaming-directory.js', 'gaming-session.js', 'gaming-client.js', 'friends-client.js','local-profile.js','profile-cover.js','profile-crop.js','cover-editor.js','cover-transfer.js','settings-drafts.js','motion.js','i18n.js', 'chat-storage.js','direct-messages.js','direct-chat.js','server-workspace.js','incoming-call.js','app-extras.js','notification-center.js', 'nudge.js', 'friend-nudges.js','peer-profile.js','account-client.js','identity-recovery.js']) await copyFile(new URL('../Vumiro.Client/WebServer/'+name,import.meta.url),new URL(name,output));
console.log('Prepared friends and call client assets.');
