using System.Security.Cryptography;
using System.Text;
using Vumiro.Android;

var checks=0;
void Check(bool value,string label){if(!value)throw new Exception(label);checks++;}
var policy=new HostPolicy(new[]{"auth.html","friends.html","call.html","android-host.js","mobile-client.js","mobile.css"});
Check(policy.AssetPath("https://vumiro.local/friends.html?roomInvite=abc")=="friends.html","root page query preserved");
foreach(var url in new[]{"http://vumiro.local/friends.html","https://vumiro.local:444/friends.html","https://evil.test/friends.html","https://u@vumiro.local/friends.html","https://vumiro.local/../secret","https://vumiro.local/%2fsecret","https://vumiro.local/android-host.js?x=1","file:///friends.html","https://vumiro.local/unknown.js"})Check(policy.AssetPath(url)==null,"reject asset "+url);
Check(policy.TrustedRpc("https://vumiro.local",true,"https://vumiro.local/auth.html"),"account main-frame RPC");
Check(!policy.TrustedRpc("https://vumiro.local",false,"https://vumiro.local/friends.html"),"reject iframe RPC");
Check(!policy.TrustedRpc("https://evil.test",true,"https://vumiro.local/friends.html"),"reject foreign origin");
Check(!policy.TrustedRpc("https://vumiro.local",true,"https://vumiro.local/call.html"),"call frame has no account storage");
Check(HostPolicy.BackAction("true")=="handled","mobile overlays consume native Back");
foreach(var result in new[]{"false","null",(string?)null})Check(HostPolicy.BackAction(result)=="background","Friends root backgrounds the app rather than reopening auth history");
foreach(var url in new[]{"https://example.com/page","https://github.com/snoopeh/Vumiro"})Check(HostPolicy.ExternalUrl(url),"public external HTTPS");
foreach(var url in new[]{"javascript:alert(1)","file:///secret","intent://app","https://user:password@example.com","https://127.0.0.1/","https://vumiro.local/"})Check(!HostPolicy.ExternalUrl(url),"reject unsafe external link");
var dir=Path.Combine(Path.GetTempPath(),"vumiro-android-host-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(dir);
try{
 var cipher=new TestCipher();var file=Path.Combine(dir,"session.bin");var store=new ProtectedSessionStore(file,cipher);
 Check(store.Get()=="","missing session");store.Set("{\"refreshToken\":\"test-secret\"}");var original=File.ReadAllBytes(file);
 Check(!Encoding.UTF8.GetString(original).Contains("test-secret"),"ciphertext only");
 Check(new ProtectedSessionStore(file,cipher).Get().Contains("test-secret"),"restart decrypts");
 cipher.Available=false;Check(!store.Available,"unavailable storage status");
 try{store.Get();throw new Exception("unavailable read accepted");}catch(SessionStoreException error){Check(error.Code=="SECURE_STORAGE_UNAVAILABLE","safe unavailable read");}
 try{store.Set("new");throw new Exception("unavailable write accepted");}catch(SessionStoreException){Check(original.SequenceEqual(File.ReadAllBytes(file)),"unavailable write preserves original");}
 store.Delete();store.Delete();Check(!File.Exists(file),"delete works without key");Check(store.Get()=="","missing read needs no key");
 cipher.Available=true;store.Set("restored");original=File.ReadAllBytes(file);
 try{store.Set(new string('x',8193));throw new Exception("oversized accepted");}catch(SessionStoreException error){Check(error.Code=="SECURE_STORAGE_INVALID_REQUEST"&&original.SequenceEqual(File.ReadAllBytes(file)),"invalid set preserves session");}
 original[^1]^=1;File.WriteAllBytes(file,original);try{store.Get();throw new Exception("tamper accepted");}catch(SessionStoreException error){Check(error.Code=="SECURE_STORAGE_READ_FAILED","tamper is sanitized");}
 Check(File.ReadAllBytes(file).SequenceEqual(original),"failed decrypt preserves ciphertext");
}finally{Directory.Delete(dir,true);}
Console.WriteLine($"PASS {checks} Android host checks.");

sealed class TestCipher:ISecretCipher{
 private readonly byte[] key=RandomNumberGenerator.GetBytes(32);public bool Available{get;set;}=true;
 public byte[] Encrypt(byte[] value){var nonce=RandomNumberGenerator.GetBytes(12);var ciphertext=new byte[value.Length];var tag=new byte[16];using var aes=new AesGcm(key,16);aes.Encrypt(nonce,value,ciphertext,tag);return [..nonce,..tag,..ciphertext];}
 public byte[] Decrypt(byte[] value){var plaintext=new byte[value.Length-28];using var aes=new AesGcm(key,16);aes.Decrypt(value[..12],value[28..],value[12..28],plaintext);return plaintext;}
}
