// One validator for Theme Studio exports, local imports and backend submissions.
import '../Vumiro.Client/WebServer/community-themes.js';
const engine=globalThis.VumiroCommunityThemes;
export const kindScopes=kind=>engine.kindScopes(kind);
export const validateMarketplacePackage=input=>engine.validate(input);
export function validateMarketplaceOverrides(input,overrides){
  const checked=validateMarketplacePackage(input);
  if(!checked.valid)return {valid:false,errors:checked.errors};
  if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))return {valid:false,errors:['Overrides must be an object']};
  const pkg=checked.package;
  const resolved=engine.resolve({packages:[pkg],bindings:[{packageId:pkg.id,version:pkg.version,overrides}]});
  return {valid:resolved.warnings.length===0,errors:resolved.warnings,overrides:resolved.warnings.length?null:JSON.parse(JSON.stringify(overrides))};
}
export async function digestPackage(input){
  const result=validateMarketplacePackage(input);
  if(!result.valid)throw Error(result.errors.join('; '));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(result.package)));
  return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
}
