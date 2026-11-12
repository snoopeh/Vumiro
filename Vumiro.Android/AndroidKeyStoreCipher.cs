using Java.Security;
using Javax.Crypto;
using Javax.Crypto.Spec;
using global::Android.Security.Keystore;
namespace Vumiro.Android;

internal sealed class AndroidKeyStoreCipher:ISecretCipher
{
    private const string Alias="vumiro.qa.account-session.v1";
    private ISecretKey Key()
    {
        using var store=KeyStore.GetInstance("AndroidKeyStore")!;store.Load(null);
        if(store.GetKey(Alias,null) is ISecretKey existing)return existing;
        using var generator=KeyGenerator.GetInstance(KeyProperties.KeyAlgorithmAes,"AndroidKeyStore")!;
        using var spec=new KeyGenParameterSpec.Builder(Alias,KeyStorePurpose.Encrypt|KeyStorePurpose.Decrypt)
            .SetBlockModes(KeyProperties.BlockModeGcm).SetEncryptionPaddings(KeyProperties.EncryptionPaddingNone)
            .SetKeySize(256).SetRandomizedEncryptionRequired(true).Build();
        generator.Init(spec);return generator.GenerateKey()!;
    }
    public bool Available{get{try{using var key=Key();return key!=null;}catch{return false;}}}
    public byte[] Encrypt(byte[] value)
    {
        using var key=Key();using var cipher=Cipher.GetInstance("AES/GCM/NoPadding")!;
        cipher.Init(CipherMode.EncryptMode,key);var iv=cipher.GetIV()!;var encrypted=cipher.DoFinal(value)!;
        return [1,..iv,..encrypted];
    }
    public byte[] Decrypt(byte[] value)
    {
        if(value.Length<29||value[0]!=1)throw new InvalidDataException();
        using var key=Key();using var cipher=Cipher.GetInstance("AES/GCM/NoPadding")!;using var spec=new GCMParameterSpec(128,value[1..13]);
        cipher.Init(CipherMode.DecryptMode,key,spec);return cipher.DoFinal(value[13..])!;
    }
}
