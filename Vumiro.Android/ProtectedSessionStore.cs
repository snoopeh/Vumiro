using System.Security.Cryptography;
using System.Text;
namespace Vumiro.Android;

public interface ISecretCipher {bool Available{get;}byte[] Encrypt(byte[] value);byte[] Decrypt(byte[] value);}
public sealed class SessionStoreException(string code):Exception("Protected account storage could not complete the request."){public string Code{get;}=code;}
public sealed class ProtectedSessionStore(string file,ISecretCipher cipher)
{
    private readonly object gate=new();
    public bool Available {get{try{return cipher.Available;}catch{return false;}}}
    public string Get()
    {
        lock(gate){if(!File.Exists(file))return "";if(!Available)throw new SessionStoreException("SECURE_STORAGE_UNAVAILABLE");
            byte[]? plaintext=null;try{plaintext=cipher.Decrypt(File.ReadAllBytes(file));return new UTF8Encoding(false,true).GetString(plaintext);}catch{throw new SessionStoreException("SECURE_STORAGE_READ_FAILED");}finally{if(plaintext!=null)CryptographicOperations.ZeroMemory(plaintext);}}
    }
    public void Set(string value)
    {
        if(value.Length>8192)throw new SessionStoreException("SECURE_STORAGE_INVALID_REQUEST");
        lock(gate){if(!Available)throw new SessionStoreException("SECURE_STORAGE_UNAVAILABLE");var temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";var plaintext=Encoding.UTF8.GetBytes(value);
            try{var encrypted=cipher.Encrypt(plaintext);Directory.CreateDirectory(Path.GetDirectoryName(file)!);using(var output=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)){output.Write(encrypted);output.Flush(true);}File.Move(temp,file,true);}
            catch{throw new SessionStoreException("SECURE_STORAGE_WRITE_FAILED");}finally{CryptographicOperations.ZeroMemory(plaintext);try{File.Delete(temp);}catch{}}}
    }
    public void Delete(){lock(gate){try{File.Delete(file);}catch{throw new SessionStoreException("SECURE_STORAGE_DELETE_FAILED");}}}
}
