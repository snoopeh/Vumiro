using System.Text;
using System.Text.Json;
using global::Android.App;
using global::Android.Content;
using global::Android.Content.PM;
using global::Android.OS;
using global::Android.Webkit;
using global::Android.Views;
using AndroidX.WebKit;
using AUri=global::Android.Net.Uri;
using AManifest=global::Android.Manifest;
namespace Vumiro.Android;

[Activity(Label="Vumiro QA",MainLauncher=true,Exported=true,WindowSoftInputMode=SoftInput.AdjustResize,ConfigurationChanges=ConfigChanges.Orientation|ConfigChanges.ScreenSize|ConfigChanges.KeyboardHidden)]
public sealed class MainActivity:Activity
{
    private WebView? web;
    private HostPolicy policy=null!;
    private ProtectedSessionStore session=null!;
    private PermissionRequest? audioRequest;
    private IValueCallback? fileRequest;
    private int fileRequestCode=100;
    private int fileNavigation;
    private int navigation;
    private int audioNavigation;
    private bool? audioDecision;
    private bool foreground;
    protected override void OnCreate(Bundle? state)
    {
        base.OnCreate(state);
        policy=new HostPolicy(Assets!.List("Web")??[]);
        session=new ProtectedSessionStore(Path.Combine(NoBackupFilesDir!.AbsolutePath,"account-session.bin"),new AndroidKeyStoreCipher());
        web=new WebView(this);web.SetBackgroundColor(global::Android.Graphics.Color.Rgb(17,17,17));SetContentView(web);
        if(OperatingSystem.IsAndroidVersionAtLeast(30)&&!OperatingSystem.IsAndroidVersionAtLeast(35))Window?.SetDecorFitsSystemWindows(false);
        web.SetOnApplyWindowInsetsListener(new InsetsListener());web.RequestApplyInsets();
        var settings=web.Settings;settings.JavaScriptEnabled=true;settings.DomStorageEnabled=true;settings.AllowFileAccess=false;settings.AllowContentAccess=false;
        settings.MixedContentMode=MixedContentHandling.NeverAllow;settings.MediaPlaybackRequiresUserGesture=false;settings.JavaScriptCanOpenWindowsAutomatically=false;settings.SetSupportMultipleWindows(false);
        web.SetWebViewClient(new LocalClient(this));web.SetWebChromeClient(new ChromeClient(this));
        if(!WebViewFeature.IsFeatureSupported(WebViewFeature.WebMessageListener)){
            var dialog=new AlertDialog.Builder(this);dialog.SetTitle("Update Android System WebView");dialog.SetMessage("Vumiro requires a current Android System WebView for its protected account bridge.");dialog.SetPositiveButton("Close",(_,_)=>Finish());dialog.Show();return;
        }
        WebViewCompat.AddWebMessageListener(web,"vumiroAndroid",new HashSet<string>{HostPolicy.Origin},new Bridge(this));
        web.LoadUrl(HostPolicy.Origin+"/auth.html");
    }
    private bool Trusted(string origin,bool mainFrame)=>web!=null&&policy.TrustedRpc(origin,mainFrame,web.Url??"");
    private void External(string url){if(!HostPolicy.ExternalUrl(url))return;try{StartActivity(new Intent(Intent.ActionView,AUri.Parse(url)).AddCategory(Intent.CategoryBrowsable));}catch{Toast("No browser is available for this link.");}}
    private void Toast(string message)=>global::Android.Widget.Toast.MakeText(this,message,global::Android.Widget.ToastLength.Long)?.Show();
    private void Event(object value){if(web==null)return;var json=JsonSerializer.Serialize(value);web.EvaluateJavascript("window.VumiroAndroidHost?.receive("+json+");",null);}
    private object Rpc(string method,JsonElement request)
    {
        switch(method){
            case "secureStore.get":return session.Get();
            case "secureStore.set":if(!request.TryGetProperty("value",out var value)||value.ValueKind!=JsonValueKind.String)throw new SessionStoreException("SECURE_STORAGE_INVALID_REQUEST");session.Set(value.GetString()!);return true;
            case "secureStore.delete":session.Delete();return true;
            case "secureStore.status":return new {available=session.Available,code=session.Available?(string?)null:"SECURE_STORAGE_UNAVAILABLE",backend="android_keystore"};
            case "oauth.signIn":throw new SessionStoreException("OAUTH_UNAVAILABLE");
            case "marketplace.openExternal":if(!request.TryGetProperty("value",out var url)||url.ValueKind!=JsonValueKind.String||!HostPolicy.HostedPayment(url.GetString()!))throw new SessionStoreException("INVALID_EXTERNAL_URL");RunOnUiThread(()=>External(url.GetString()!));return true;
            case "postMessage":
                if(request.TryGetProperty("value",out var message)&&message.ValueKind==JsonValueKind.Object&&message.TryGetProperty("type",out var type)){
                    if(type.GetString()=="updates")RunOnUiThread(()=>Event(new{type="updates",current="Android QA",available=false,busy=false,message="Android QA updates are installed as a new APK. Desktop updates are unavailable.",progress=0}));
                    else if(type.GetString()=="window"&&message.TryGetProperty("action",out var action)&&action.GetString()=="state")RunOnUiThread(()=>Event(new{type="window-state",maximized=false,fullscreen=false,visible=true,minimized=false,backdrop=false}));
                }return true;
            default:throw new SessionStoreException("UNSUPPORTED_ACTION");
        }
    }
    private sealed class Bridge(MainActivity host):Java.Lang.Object,WebViewCompat.IWebMessageListener
    {
        public void OnPostMessage(WebView? view,WebMessageCompat? message,AUri? sourceOrigin,bool isMainFrame,JavaScriptReplyProxy? replyProxy)
        {
            var origin=sourceOrigin?.ToString()?.TrimEnd('/')??"";
            if(replyProxy==null||!host.Trusted(origin,isMainFrame)||message?.Data is not string data||data.Length>20000)return;
            JsonElement request;string id,method;
            try{using var document=JsonDocument.Parse(data);request=document.RootElement.Clone();id=request.GetProperty("id").GetString()!;method=request.GetProperty("method").GetString()!;if(!Guid.TryParse(id,out _)||method.Length>80||request.EnumerateObject().Any(p=>p.Name is not ("id" or "method" or "value")))return;}catch{return;}
            // AndroidX dispatches on the UI thread. Keep these bounded local
            // operations ordered with navigation and sign-out; never queue a
            // stale credential write behind a later page's requests.
            object response;
            try{response=new{id,ok=true,result=host.Rpc(method,request)};}
            catch(SessionStoreException error){response=new{id,ok=false,error=new{code=error.Code,message=error.Code=="OAUTH_UNAVAILABLE"?"Browser provider sign-in is unavailable in this Android QA build. Use email sign-in.":"The Android host could not complete the request."}};}
            catch{response=new{id,ok=false,error=new{code="HOST_FAILED",message="The Android host could not complete the request."}};}
            replyProxy.PostMessage(JsonSerializer.Serialize(response));
        }
    }
    private sealed class LocalClient(MainActivity host):WebViewClient
    {
        public override void OnPageStarted(WebView? view,string? url,global::Android.Graphics.Bitmap? favicon){host.navigation++;host.audioRequest?.Deny();host.audioRequest=null;host.audioDecision=null;host.fileRequest?.OnReceiveValue(null);host.fileRequest=null;base.OnPageStarted(view,url,favicon);}
        public override bool ShouldOverrideUrlLoading(WebView? view,IWebResourceRequest? request){var url=request?.Url?.ToString()??"";if(host.policy.AssetPath(url) is "friends.html" or "auth.html" or "call.html")return false;if(request?.IsForMainFrame==true)host.External(url);return true;}
        public override WebResourceResponse? ShouldInterceptRequest(WebView? view,IWebResourceRequest? request)
        {
            var url=request?.Url?.ToString()??"";if(!url.StartsWith(HostPolicy.Origin+"/",StringComparison.Ordinal))return base.ShouldInterceptRequest(view,request);
            var path=host.policy.AssetPath(url);if(path==null||request?.Method!="GET")return new WebResourceResponse("text/plain","utf-8",404,"Not Found",new Dictionary<string,string>(),new MemoryStream());
            try{var extension=Path.GetExtension(path);var mime=extension switch{".html"=>"text/html",".js"=>"text/javascript",".css"=>"text/css",".json"=>"application/json",_=>"text/plain"};
                var headers=new Dictionary<string,string>{{"Cache-Control","no-store"},{"X-Content-Type-Options","nosniff"},{"Content-Security-Policy","default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' https: wss: blob:; frame-src 'self'; object-src 'none'"},{"Permissions-Policy","camera=(), microphone=(self), display-capture=()"}};
                return new WebResourceResponse(mime,"utf-8",200,"OK",headers,host.Assets!.Open("Web/"+path));
            }catch{return new WebResourceResponse("text/plain","utf-8",404,"Not Found",new Dictionary<string,string>(),new MemoryStream());}
        }
    }
    private sealed class ChromeClient(MainActivity host):WebChromeClient
    {
        public override void OnPermissionRequest(PermissionRequest? request)
        {
            if(request==null)return;if(!host.foreground||request.Origin?.ToString()?.TrimEnd('/')!=HostPolicy.Origin||host.web?.Url is not string url||host.policy.AssetPath(url) is not ("friends.html" or "call.html")||request.GetResources()?.Contains(PermissionRequest.ResourceAudioCapture)!=true){request.Deny();return;}
            if(host.CheckSelfPermission(AManifest.Permission.RecordAudio)==Permission.Granted){request.Grant([PermissionRequest.ResourceAudioCapture!]);return;}
            host.audioRequest?.Deny();host.audioRequest=request;host.audioDecision=null;host.audioNavigation=host.navigation;host.RequestPermissions([AManifest.Permission.RecordAudio],41);
        }
        public override void OnPermissionRequestCanceled(PermissionRequest? request){if(host.audioRequest==request){host.audioRequest=null;host.audioDecision=null;}}
        public override bool OnJsConfirm(WebView? view,string? url,string? message,JsResult? result)
        {
            if(result==null||host.policy.AssetPath(url??"")==null)return false;
            var dialog=new AlertDialog.Builder(host);dialog.SetTitle("Vumiro QA");dialog.SetMessage(message);dialog.SetPositiveButton("Continue",(_,_)=>result.Confirm());dialog.SetNegativeButton("Cancel",(_,_)=>result.Cancel());dialog.SetOnCancelListener(new CancelConfirm(result));dialog.Show();return true;
        }
        public override bool OnShowFileChooser(WebView? view,IValueCallback? callback,FileChooserParams? parameters)
        {
            if(callback==null||host.web?.Url is not string url||!host.policy.TrustedRpc(HostPolicy.Origin,true,url))return false;
            host.fileRequest?.OnReceiveValue(null);host.fileRequest=callback;
            host.fileNavigation=host.navigation;var requestCode=++host.fileRequestCode;
            var intent=new Intent(Intent.ActionOpenDocument);intent.AddCategory(Intent.CategoryOpenable);intent.SetType("*/*");intent.PutExtra(Intent.ExtraAllowMultiple,parameters?.Mode==ChromeFileChooserMode.OpenMultiple);
            try{host.StartActivityForResult(intent,requestCode);}catch{host.fileRequest=null;callback.OnReceiveValue(null);}return true;
        }
    }
    public override void OnRequestPermissionsResult(int requestCode,string[] permissions,Permission[] grantResults){base.OnRequestPermissionsResult(requestCode,permissions,grantResults);if(requestCode==41&&audioRequest!=null){audioDecision=grantResults.Length>0&&grantResults[0]==Permission.Granted;if(foreground)ResumeAudio();}}
    private void ResumeAudio()=>web?.EvaluateJavascript("window.VumiroAndroidHost?.foreground();",new ResumeAudioResult(this));
    private void CompleteAudioPermission()
    {
        if(audioRequest==null||!audioDecision.HasValue||!foreground)return;
        var pending=audioRequest;audioRequest=null;var page=policy.AssetPath(web?.Url??"");
        if(audioDecision==true&&audioNavigation==navigation&&CheckSelfPermission(AManifest.Permission.RecordAudio)==Permission.Granted&&(page is "friends.html" or "call.html"))pending.Grant([PermissionRequest.ResourceAudioCapture!]);else pending.Deny();audioDecision=null;
    }
    private sealed class ResumeAudioResult(MainActivity host):Java.Lang.Object,IValueCallback{public void OnReceiveValue(Java.Lang.Object? value)=>host.CompleteAudioPermission();}
    protected override void OnActivityResult(int requestCode,Result resultCode,Intent? data){base.OnActivityResult(requestCode,resultCode,data);if(requestCode==fileRequestCode){fileRequest?.OnReceiveValue(fileNavigation==navigation?WebChromeClient.FileChooserParams.ParseResult((int)resultCode,data):null);fileRequest=null;}}
    public override void OnBackPressed(){if(web==null){Finish();return;}web.EvaluateJavascript("Boolean(window.VumiroMobile?.back?.())",new BackResult(this));}
    private sealed class BackResult(MainActivity host):Java.Lang.Object,IValueCallback{public void OnReceiveValue(Java.Lang.Object? value){if(HostPolicy.BackAction(value?.ToString())=="background")host.MoveTaskToBack(true);}}
    protected override void OnPause(){foreground=false;var preserve=audioRequest!=null&&!audioDecision.HasValue;web?.EvaluateJavascript("window.VumiroAndroidHost?.background("+(preserve?"true":"false")+");",null);web?.OnPause();base.OnPause();}
    protected override void OnResume(){base.OnResume();foreground=true;web?.OnResume();ResumeAudio();}
    protected override void OnDestroy(){navigation++;audioRequest?.Deny();fileRequest?.OnReceiveValue(null);web?.Destroy();web=null;base.OnDestroy();}
    private sealed class CancelConfirm(JsResult result):Java.Lang.Object,IDialogInterfaceOnCancelListener{public void OnCancel(IDialogInterface? dialog)=>result.Cancel();}
    private sealed class InsetsListener:Java.Lang.Object,View.IOnApplyWindowInsetsListener
    {
        public WindowInsets OnApplyWindowInsets(View view,WindowInsets insets)
        {
            if(OperatingSystem.IsAndroidVersionAtLeast(30)){var safe=insets.GetInsets(WindowInsets.Type.SystemBars()|WindowInsets.Type.Ime());view.SetPadding(safe.Left,safe.Top,safe.Right,safe.Bottom);}
            else view.SetPadding(insets.SystemWindowInsetLeft,insets.SystemWindowInsetTop,insets.SystemWindowInsetRight,insets.SystemWindowInsetBottom);
            return insets;
        }
    }
}
