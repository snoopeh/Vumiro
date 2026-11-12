(() => {
  'use strict';

  const css = `
:host{display:block;height:100%;min-height:0;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
.ch-root{--ch-chrome:#1d1e23;--ch-sidebar:#24252b;--ch-raised:#2e3037;--ch-text:#f0eff3;--ch-muted:#a4a3ae;--ch-line:#ffffff0f;--ch-accent:#ef7b76;--ch-active:#ffffff0c;--community-surface:#2b2c33;--community-surface-raised:#32343c;--community-text:#f0eff3;--community-muted:#aaa9b4;--community-accent:#ef7b76;--community-accent-text:#251415;--community-border:#ffffff15;--community-danger:#ff9298;--community-radius:8px;--community-spacing:8px;position:relative;isolation:isolate;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;background:var(--ch-chrome);color:var(--ch-text);font:14px/1.5 "Segoe UI",system-ui,sans-serif}
button,input,textarea,select{font:inherit;color:inherit}
button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:32px;max-width:100%;padding:7px 12px;border:1px solid transparent;border-radius:6px;background:var(--community-surface-raised);color:var(--community-text);font-size:13px;font-weight:600;line-height:1.35;text-align:left;cursor:pointer;touch-action:manipulation}
button:hover{background:color-mix(in srgb,var(--community-text) 8%,var(--community-surface-raised))}
button:disabled{opacity:.45;cursor:default}
button[data-variant=primary]{background:var(--community-accent);color:var(--community-accent-text)}
button[data-variant=secondary]{background:var(--community-surface-raised);border-color:var(--community-border);color:var(--community-text)}
button[data-variant=quiet]{background:transparent;color:var(--community-muted)}
button[data-variant=quiet]:hover{background:#ffffff0a;color:var(--community-text)}
button[data-variant=danger]{background:#f8717114;color:var(--community-danger);border-color:#f8717130}
button[data-variant=danger]:hover{background:#f8717125}
:focus-visible{outline:2px solid var(--community-accent);outline-offset:3px}
input,textarea,select{min-width:0;max-width:100%;padding:9px 12px;border:1px solid var(--community-border);border-radius:6px;background:var(--community-surface);color:var(--community-text);font-size:14px}
input::placeholder,textarea::placeholder{color:var(--community-muted);opacity:.8}
input[type=checkbox]{accent-color:var(--community-accent)}
textarea{width:100%;min-height:88px;resize:vertical;line-height:1.5}
svg.ch-icon{display:block;width:20px;height:20px;flex:none;pointer-events:none}
h1,h2,h3,h4,p{margin:0}
h1{font-size:15px;font-weight:700;line-height:1.3}
h2{font-family:var(--community-font-heading,inherit);font-size:clamp(24px,3vw,34px);font-weight:700;line-height:1.2;letter-spacing:-.025em}
h3{font-size:16px;font-weight:650;line-height:1.4}
h4{font-size:13px;font-weight:650}
small,.ch-muted{color:var(--community-muted);font-size:12px}
.ch-shell{display:grid;grid-template-columns:264px minmax(0,1fr);flex:1;min-height:0;overflow:hidden}
.ch-sidebar{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--ch-sidebar);color:var(--ch-text);border-right:1px solid var(--ch-line);--community-surface:var(--ch-sidebar);--community-surface-raised:var(--ch-raised);--community-text:var(--ch-text);--community-muted:var(--ch-muted);--community-accent:var(--ch-accent);--community-border:var(--ch-line)}
.ch-side-head{display:flex;align-items:center;gap:8px;min-height:56px;padding:12px 16px;border-bottom:1px solid var(--ch-line);flex:none}
.ch-side-head>div:first-child{flex:1;min-width:0}
.ch-side-head h1{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ch-side-head p{color:var(--ch-muted);font-size:11px;margin-top:3px}
.ch-side-head select{width:100%;padding:4px 0;border:0;background:transparent;font-weight:700;font-size:14px}
.ch-side-head .ch-actions{flex:none;gap:0}
.ch-side-tools{display:flex;flex-direction:column;gap:8px;flex:none;padding:12px 12px 8px}
.ch-side-tools input{width:100%;min-height:32px;background:var(--ch-chrome);border-color:transparent;font-size:12px;padding:7px 10px}
.ch-side-tools>button{justify-content:flex-start;background:transparent;font-size:13px;color:var(--ch-muted)}
.ch-side-tools>button:hover,.ch-side-tools>button[aria-current=page]{background:var(--ch-active);color:var(--ch-text)}
.ch-tree{display:flex;flex:1;min-height:0;flex-direction:column;gap:2px;overflow:auto;overscroll-behavior:contain;padding:4px 8px 16px;scrollbar-width:thin;scrollbar-color:#ffffff22 transparent}
.ch-row{position:relative;display:flex;align-items:center;gap:2px;min-height:34px;flex:none;border-radius:5px;color:var(--ch-muted)}
.ch-row:hover,.ch-row:focus-within{background:var(--ch-active);color:var(--ch-text)}
.ch-row>button{border:0;background:transparent;color:inherit;padding:6px 8px;font-weight:500;min-width:0;justify-content:flex-start}
.ch-row>button:not(.ch-toggle):not(.ch-icon-button):not(.ch-node-main){flex:1}
.ch-row .ch-node-main{flex:1;min-width:0;overflow:hidden;justify-content:flex-start;gap:9px;white-space:nowrap;text-overflow:ellipsis}
.ch-node-main>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.ch-root .ch-row[aria-current=page],.ch-root .ch-row:has(>button[aria-current=page]){background:#ffffff10;color:var(--ch-text)}
.ch-row[aria-current=page]::before,.ch-row:has(>button[aria-current=page])::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:3px;background:var(--ch-accent);border-radius:0 3px 3px 0}
.ch-row[data-kind=folder]{margin-top:12px;min-height:28px;font-size:11px;color:var(--ch-muted)}
.ch-row[data-kind=folder] .ch-node-main{font-size:11px;font-weight:650;letter-spacing:.055em;text-transform:uppercase}
.ch-row-space,.ch-row[data-kind=space]{min-height:48px;border-top:1px solid var(--ch-line);border-radius:0;margin-top:16px;padding-top:10px;padding-bottom:4px;color:var(--ch-text)}
.ch-row-space .ch-node-main,.ch-row[data-kind=space] .ch-node-main{font-size:13px;font-weight:700;gap:8px}
.ch-space-tile{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border-radius:8px;background:#ef7b7617;color:#e69a95;font-size:12px;font-weight:750;line-height:1}
.ch-row[data-space] .ch-space-tile{background:#ffffff0a}
.ch-row .ch-toggle{width:24px;min-width:24px;padding:4px;justify-content:center;flex:none}
.ch-toggle[aria-expanded=true] .ch-icon{transform:rotate(90deg)}
.ch-row-actions{display:flex;align-items:center;gap:0;flex:none;margin-left:auto}
.ch-root button.ch-icon-button{display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 32px!important;width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;max-width:32px!important;max-height:32px!important;margin:0!important;padding:6px!important;gap:0!important;border-width:0!important;border-radius:5px!important;background:transparent;color:var(--community-muted);box-shadow:none!important}
.ch-root button.ch-icon-button:hover{background:#ffffff0d;color:var(--community-text)}
.ch-root button.ch-icon-button[data-variant=danger]{color:var(--community-danger)}
.ch-row-actions .ch-icon-button{opacity:0}
.ch-row:hover .ch-row-actions .ch-icon-button,.ch-row:focus-within .ch-row-actions .ch-icon-button{opacity:1}
.ch-voice-people{display:flex;flex-direction:column;gap:2px;margin:2px 0 6px 40px;flex:none}
.ch-voice-people>*,.ch-voice-person{display:flex;align-items:center;gap:8px;min-height:28px;font-size:12px;color:var(--ch-muted)}
.ch-voice-avatar{width:20px;height:20px;display:inline-grid;place-items:center;border-radius:50%;background:var(--ch-raised);font-size:10px;flex:none}
.ch-voice-dock{display:flex;align-items:center;gap:8px;flex:none;min-height:64px;padding:12px;background:var(--ch-chrome);border-top:1px solid var(--ch-line)}
.ch-voice-dock>div:first-child{flex:1;min-width:0}
.ch-voice-dock strong{display:block;font-size:12px;color:#8dcea5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ch-voice-dock p,.ch-voice-dock small{display:block;font-size:11px;line-height:1.5;color:var(--ch-muted)}
.ch-voice-dock .ch-actions{gap:0;flex:none}
.ch-content{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--community-surface);color:var(--community-text)}
.ch-channel-header{display:flex;align-items:center;gap:12px;flex:none;min-height:56px;padding:10px 24px;border-bottom:1px solid var(--community-border);background:color-mix(in srgb,var(--community-surface) 96%,#000);z-index:1}
.ch-channel-header>.ch-icon{color:var(--community-muted)}
.ch-channel-header>div:first-of-type{min-width:0;flex:1}
.ch-channel-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;font-weight:700;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ch-channel-description{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--community-muted);font-size:12px;margin-top:2px}
.ch-channel-header .ch-actions{gap:4px;flex:none;margin-left:auto}
.ch-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:24px 32px 40px;scrollbar-width:thin;scrollbar-color:var(--community-border) transparent}
.ch-chat{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;overflow:hidden;position:relative}
.ch-history{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:24px 24px 12px;scrollbar-width:thin;scrollbar-color:var(--community-border) transparent}
.ch-history>.ch-list{margin:0}
.ch-list{display:flex;flex-direction:column;gap:0;list-style:none;padding:0;margin:20px 0}
.ch-message{display:flex;align-items:flex-start;gap:12px;padding:9px 8px;border-radius:5px;min-width:0;border:0}
.ch-message:hover{background:#0000000c}
.ch-avatar,.ch-message-avatar{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:12px;background:color-mix(in srgb,var(--community-accent) 14%,var(--community-surface-raised));color:var(--community-accent);font-size:12px;font-weight:700;overflow:hidden}
.ch-avatar img,.ch-message-avatar img{width:100%;height:100%;object-fit:cover}
.ch-message-body{flex:1;min-width:0}
.ch-message-meta{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:2px;font-size:12px;line-height:1.4}
.ch-message-meta strong{font-size:13px;font-weight:650}
.ch-message-meta small,.ch-message-meta time{color:var(--community-muted);font-size:11px}
.ch-message p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.6}
.ch-content[data-density=compact] .ch-message,.ch-content[data-room-layout=compact] .ch-message{padding-top:5px;padding-bottom:5px}
.ch-composer{display:flex;align-items:flex-end;gap:8px;flex:none;flex-wrap:wrap;margin:8px 24px 0;padding:8px 8px 8px 16px;border-radius:9px;background:var(--community-surface-raised);border:1px solid var(--community-border)}
.ch-composer textarea{display:block;flex:1;width:auto;min-width:0;min-height:36px;max-height:160px;margin:0;padding:8px 0;resize:none;overflow:auto;border:0;border-radius:0;background:transparent;box-shadow:none;line-height:1.45}
.ch-composer textarea:focus-visible{outline:0}
.ch-composer:focus-within{outline:2px solid var(--community-accent);outline-offset:2px}
.ch-composer>button{flex:none;margin-bottom:2px}
.ch-composer-hint{flex:none;font-size:11px;line-height:1.5;color:var(--community-muted);padding:7px 28px 12px}
.ch-composer>.ch-composer-hint{flex-basis:100%;padding:0 0 2px}
.ch-new-messages{position:absolute;bottom:20px;left:50%;transform:translateX(-50%);z-index:3;box-shadow:0 4px 18px #0006;border-radius:18px;white-space:nowrap}
.ch-chat>.ch-new-messages{top:8px;bottom:auto}
.ch-crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:4px;color:var(--community-muted);font-size:11px;margin-bottom:20px}
.ch-crumbs button{min-height:24px;padding:2px 4px;background:transparent;color:inherit;font-size:11px;font-weight:400}
.ch-status{flex:none;min-height:24px;padding:4px 16px;border-top:1px solid var(--ch-line);background:var(--ch-chrome);color:var(--ch-muted);font-size:10px;line-height:1.5}
.ch-error{color:var(--community-danger);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
.ch-error:not(:empty){padding:8px 16px;background:#f871710d}
.ch-card{background:var(--community-surface-raised);border:1px solid var(--community-border);border-radius:var(--community-radius);padding:20px;margin:16px 0;box-shadow:var(--community-shadow,none)}
.ch-card>p,.ch-banner>p{margin-top:8px}
.ch-banner{padding:32px;border-radius:var(--community-radius);border:1px solid var(--community-border);border-left:3px solid var(--community-accent);background:linear-gradient(120deg,var(--community-surface-raised),var(--community-surface));margin-bottom:24px}
.ch-banner>.ch-muted:first-child{margin:0 0 12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.ch-banner h2{max-width:640px}
.ch-banner p{max-width:680px}
.ch-overview{max-width:1024px;margin:0 auto;padding:8px 0}
.ch-overview>h2{margin-bottom:8px}
.ch-overview>.ch-muted{margin-bottom:24px}
.ch-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.ch-destinations{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0 28px}
.ch-destination{display:flex;align-items:center;justify-content:flex-start;gap:12px;min-height:80px;padding:16px;border:1px solid var(--community-border);border-radius:8px;background:var(--community-surface-raised);color:var(--community-text);text-align:left}
.ch-destination>div{min-width:0;flex:1}
.ch-destination strong{display:block;font-size:14px}
.ch-destination p,.ch-destination small{display:block;font-size:12px;font-weight:400;color:var(--community-muted);margin-top:4px}
.ch-destination>.ch-icon{color:var(--community-accent)}
.ch-destination:hover{border-color:color-mix(in srgb,var(--community-accent) 45%,var(--community-border))}
.ch-overview .ch-card{box-shadow:none;border-color:transparent}
.ch-split{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:24px}
.ch-actions,.ch-tabs{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.ch-tabs{margin-bottom:24px}
.ch-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid var(--ch-line)}
.ch-top p{color:var(--ch-muted);font-size:11px}
.ch-badge{display:inline-flex;align-items:center;border:1px solid var(--community-border);border-radius:4px;padding:2px 6px;font-size:10px;font-weight:500;line-height:1.5}
.ch-empty{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:8px;padding:40px 8px;color:var(--community-muted)}
.ch-field{display:flex;flex-direction:column;gap:6px;margin:16px 0;font-size:12px;font-weight:600}
.ch-field>input,.ch-field>select,.ch-field>textarea{width:100%;font-weight:400}
.ch-form{max-width:680px}
.ch-form>button[type=submit]{margin-top:8px}
.ch-content[data-density=compact] .ch-card{padding:16px;margin:12px 0}
.ch-members summary{cursor:pointer;font-size:12px;color:var(--community-muted)}
.ch-members p{font-size:12px;margin-top:8px}
.ch-content[data-room-layout=theater] .ch-voice-room{min-height:300px;display:grid;place-items:center}
.ch-settings-layer,.ch-dialog-layer{position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:24px;background:#111217cc;backdrop-filter:blur(8px);color:var(--ch-text)}
.ch-settings-frame{position:relative;display:grid;grid-template-columns:200px minmax(0,1fr);width:100%;height:100%;max-width:1100px;max-height:820px;min-height:0;overflow:hidden;background:var(--ch-sidebar);border:1px solid var(--ch-line);border-radius:12px;box-shadow:0 24px 96px #0008;--community-surface:var(--ch-sidebar);--community-surface-raised:var(--ch-raised);--community-text:var(--ch-text);--community-muted:var(--ch-muted);--community-accent:var(--ch-accent);--community-border:var(--ch-line)}
.ch-settings-nav{display:flex;flex-direction:column;gap:4px;overflow:auto;min-height:0;padding:24px 12px;background:var(--ch-chrome);border-right:1px solid var(--ch-line)}
.ch-settings-nav h2,.ch-settings-nav h3{font-family:inherit;font-size:11px;line-height:1.5;text-transform:uppercase;letter-spacing:.065em;color:var(--ch-muted);margin:0 12px 16px;overflow-wrap:anywhere}
.ch-settings-nav button{justify-content:flex-start;background:transparent;color:var(--ch-muted);font-size:13px}
.ch-settings-nav button[aria-current=page],.ch-settings-nav button:hover{background:var(--ch-active);color:var(--ch-text)}
.ch-settings-nav .ch-close-settings{margin-top:auto}
.ch-settings-body{min-width:0;min-height:0;overflow:auto;padding:28px 32px 40px;scrollbar-width:thin}
.ch-settings-body>h2{font-size:22px;margin-bottom:8px}
.ch-settings-body>.ch-crumbs{margin-bottom:12px}
.ch-settings-body .ch-card{border-color:transparent;margin-top:20px;box-shadow:none}
.ch-dialog-layer{z-index:60}
.ch-dialog{display:flex;flex-direction:column;gap:8px;max-width:480px;width:100%;max-height:100%;overflow:auto;padding:24px;border:1px solid var(--ch-line);border-radius:12px;background:var(--ch-sidebar);box-shadow:0 24px 96px #0008}
.ch-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:16px}
.ch-dialog-head h2,.ch-dialog-head h3{font-size:20px;font-family:inherit;line-height:1.3}
.ch-dialog>p{color:var(--ch-muted);font-size:12px}
.ch-dialog-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:16px}
.ch-dialog .ch-form{max-width:none}
.ch-studio{margin-top:24px}
.community-theme-studio>p,.community-studio-description{margin:12px 0 20px;color:var(--community-muted);max-width:680px;font-size:13px}
.community-studio-status{font-size:12px;color:var(--community-muted);margin:12px 0}
.community-studio-section{border-bottom:1px solid var(--community-border);padding:0 0 20px;margin:20px 0}
.community-studio-section-title{cursor:pointer;font-size:14px;font-weight:650;padding:4px 0;line-height:1.5}
.community-studio-section-description{font-size:12px;color:var(--community-muted);margin:8px 0 16px;max-width:600px}
.community-studio-fields,.community-studio-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:16px 0}
.community-studio-fields label,.community-studio-controls label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600;min-width:0}
.community-studio-fields input,.community-studio-fields select,.community-studio-fields textarea,.community-studio-controls input,.community-studio-controls select,.community-studio-controls textarea{width:100%;min-width:0;font-weight:400}
.community-studio-fields input[type=color],.community-studio-controls input[type=color]{height:40px;padding:4px}
.community-studio-section-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0}
.community-studio-actions{position:sticky;bottom:-40px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:24px -8px -16px;padding:16px 8px;background:var(--community-surface);border-top:1px solid var(--community-border);z-index:2}
fieldset{min-width:0;border:1px solid var(--community-border);border-radius:8px;margin:16px 0;padding:16px}
legend{padding:0 8px;font-size:12px;font-weight:600}
.ch-mobile-nav,.ch-drawer-shade{display:none!important}
@media(hover:none),(pointer:coarse){.ch-row-actions .ch-icon-button{opacity:1}}
@media(max-width:900px){.ch-scroll{padding:24px}.ch-split{grid-template-columns:1fr;gap:16px}.ch-settings-body{padding:24px}.ch-settings-layer{padding:16px}}
@media(max-width:700px){
 .ch-shell{display:flex;position:relative;min-width:0}.ch-content{flex:1;width:100%}
 .ch-sidebar{position:absolute;left:0;top:0;bottom:0;width:min(300px,calc(100% - 48px));z-index:31;visibility:hidden;transform:translateX(-101%);transition:transform .18s ease,visibility .18s;box-shadow:12px 0 40px #0006}
 .ch-root[data-nav-open=true] .ch-sidebar{visibility:visible;transform:translateX(0)}
 .ch-root[data-nav-open=true] .ch-drawer-shade{display:block!important;position:absolute;inset:0;z-index:30;background:#0008;border:0;border-radius:0;width:100%;height:100%;padding:0}
 .ch-root .ch-mobile-nav{display:inline-flex!important;flex:none}
 .ch-channel-header{gap:8px;padding:8px 12px;min-height:56px}.ch-channel-header .ch-channel-description{font-size:11px}
 .ch-history{padding:16px 8px 8px}.ch-message{gap:10px;padding:8px}.ch-avatar,.ch-message-avatar{width:32px;height:32px;border-radius:10px}
 .ch-composer{margin:4px 12px 0;padding-left:12px}.ch-composer-hint{padding:6px 16px 10px;font-size:10px}
 .ch-scroll{padding:20px 16px 32px}.ch-banner{padding:24px 20px}.ch-grid,.ch-destinations{grid-template-columns:1fr}
 .ch-settings-layer,.ch-dialog-layer{padding:12px}.ch-settings-frame{grid-template-columns:144px minmax(0,1fr);border-radius:8px;max-height:none}.ch-settings-nav{padding:16px 8px}.ch-settings-nav h2,.ch-settings-nav h3{margin:0 8px 12px;font-size:10px}.ch-settings-nav button{padding:8px;font-size:12px}.ch-settings-body{padding:20px 16px 32px}
 .ch-settings-body .ch-card{padding:16px 12px}.community-studio-fields,.community-studio-controls{grid-template-columns:1fr}.community-studio-actions{bottom:-32px}.ch-dialog{padding:20px}
 .ch-status{padding:4px 12px;font-size:10px}.ch-top{padding:12px;flex-wrap:wrap}
}
@media(max-width:420px){.ch-settings-frame{display:flex;flex-direction:column}.ch-settings-nav{flex:none;flex-direction:row;flex-wrap:wrap;gap:2px;padding:10px;border-right:0;border-bottom:1px solid var(--ch-line);overflow:visible}.ch-settings-nav h2,.ch-settings-nav h3{width:100%;margin:0 6px 4px}.ch-settings-nav button{min-height:30px;font-size:11px;padding:6px 8px}.ch-settings-body{flex:1}.ch-settings-nav .ch-close-settings{margin-left:auto;margin-top:0}.ch-channel-header .ch-actions{gap:0}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@media(forced-colors:active){.ch-row[aria-current=page],.ch-row:has(>button[aria-current=page]){outline:1px solid Highlight;outline-offset:-1px}.ch-row-actions .ch-icon-button{opacity:1}.ch-composer:focus-within{outline-color:Highlight}}

/* Controller-specific regions retain fixed geometry across portable themes. */
.ch-list.ch-history{padding:24px 24px 12px;margin:0}
.ch-compose-row{display:flex;align-items:flex-end;gap:8px;width:100%;min-width:0}
.ch-compose-row textarea{flex:1;width:0}
.ch-side-tools{display:grid;grid-template-columns:minmax(0,1fr) 32px;align-items:center;padding:8px 12px}
.ch-sidebar>input{margin:0 12px 12px;width:calc(100% - 24px);font-size:12px;min-height:32px;padding:6px 10px}
.ch-mode{font-size:11px;color:var(--ch-muted);padding:8px 16px 0}
.ch-eyebrow{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ch-muted)}
.ch-side-head .ch-field{margin:0;gap:0}.ch-side-head .ch-field>span{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden}
.ch-scroll.ch-overview{width:100%;max-width:none;margin:0;padding:28px 32px 40px}
.ch-overview>*{max-width:1040px;margin-left:auto;margin-right:auto}
.ch-current-space{display:block;font-size:11px;line-height:1.2;color:var(--community-muted)}
.ch-channel-header>.ch-channel-description{flex:1;padding-left:12px;border-left:1px solid var(--community-border)}
.ch-channel-header>.ch-icon-button:last-child{margin-left:auto!important}
.ch-channel-intro{padding:24px 8px 28px}.ch-channel-intro>.ch-icon{width:40px;height:40px;color:var(--community-muted);margin-bottom:12px}.ch-channel-intro h2{font-size:26px}.ch-channel-intro p{margin-top:8px}
.ch-history-load{display:flex;justify-content:center;padding:0 0 16px}.ch-history-load button{background:transparent;color:var(--community-muted);font-size:12px}
.ch-unread{margin-left:auto;border-radius:6px;background:var(--ch-accent);color:#211719;font-size:11px;padding:1px 5px}
.ch-person-avatar{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:var(--ch-raised);font-size:10px}
.ch-voice-info>.ch-icon{display:none}.ch-node-main[data-connected=true]{color:#8dcea5}
.ch-permission-result{margin-top:16px}.ch-permission-row{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--community-border)}.ch-permission-row>span{flex:1}.ch-permission-row strong{font-size:12px}
.ch-theme-preview{padding:20px;border-radius:8px;margin:20px 0;border:1px solid var(--community-border)}.ch-theme-preview>h3{margin:8px 0}.ch-theme-preview .ch-card{margin:16px 0 0}
.ch-notice{font-size:12px;padding:8px 16px;background:#ffffff08;overflow-wrap:anywhere}
.ch-root>.ch-new-messages{bottom:100px}
.ch-settings-nav>.ch-eyebrow{margin:0}.ch-settings-nav>strong{display:block;margin:4px 0 20px;overflow-wrap:anywhere}
@media(max-width:700px){.ch-list.ch-history{padding:16px 12px 8px}.ch-scroll.ch-overview{padding:20px 16px 28px}.ch-channel-description{display:none}.ch-composer{margin-left:12px;margin-right:12px}.ch-mode{font-size:12px}}

.ch-root button.ch-mobile-nav{display:none!important}
.ch-composer textarea:focus-visible{outline:none!important}
.ch-hub-title{min-width:0;flex:1}.ch-hub-title>.ch-eyebrow{font-size:10px}
.ch-sidebar .ch-side-head{min-height:68px}
@media(max-width:700px){.ch-root button.ch-mobile-nav{display:inline-flex!important}}

.ch-home-hero{padding:12px 0 28px}.ch-home-hero h2{margin:10px 0}.ch-home-hero>p:last-child{color:var(--community-muted);max-width:680px;font-size:14px;line-height:1.7}
.ch-home-announcement{padding:16px 20px;margin:0 0 28px;border-left:3px solid var(--community-accent);border-radius:0 6px 6px 0;background:var(--community-surface-raised)}.ch-home-announcement p{margin-top:8px}
.ch-home-activity{padding-top:8px}.ch-home-activity>p{margin-top:16px}.ch-activity-row{padding:16px 0;border-bottom:1px solid var(--community-border)}.ch-activity-row p{margin-top:4px;overflow-wrap:anywhere}
.ch-row-actions{width:0;overflow:hidden}.ch-row:hover .ch-row-actions,.ch-row:focus-within .ch-row-actions,.ch-row[data-kind=space] .ch-row-actions{width:auto;overflow:visible}.ch-row[data-kind=space] .ch-row-actions .ch-icon-button{opacity:.8}
.ch-admission{margin-top:32px;color:var(--community-muted);font-size:12px}.ch-destination>.ch-icon:last-child{width:16px;height:16px;color:var(--community-muted)}
@media(hover:none),(pointer:coarse){.ch-row-actions{width:auto;overflow:visible}}

/* The curated editor belongs to app chrome; the preview alone receives the draft. */
.community-space-customizer{min-width:0;max-width:1100px;margin:0 auto}
.ch-settings-frame:has(.community-space-customizer){max-width:1400px}
.ch-appearance-workbench{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.8fr);gap:24px;align-items:start}
.ch-appearance-workbench>.ch-theme-preview{position:sticky;top:12px;margin-top:24px}
.ch-appearance-workbench .community-theme-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}
.ch-appearance-workbench .community-appearance-fields{grid-template-columns:repeat(2,minmax(0,1fr))}
.ch-theme-preview-activity{padding:16px;margin:12px 0;border-radius:var(--community-radius)}
.ch-theme-preview-activity p{margin-top:8px;color:var(--community-muted)}
.community-appearance-header{display:flex;gap:24px;align-items:flex-start;justify-content:space-between;margin:8px 0 32px}
.community-appearance-header h2{font-size:26px;margin:8px 0 12px}
.community-appearance-header>.community-studio-description{margin:0}
.community-appearance-header>button{flex:none;margin-top:28px}
.community-appearance-eyebrow{color:var(--community-accent);font-size:10px;font-weight:700;letter-spacing:.14em}
.community-appearance-collection{margin-bottom:32px}
.community-theme-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0 24px}
.community-theme-gallery>button{display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch;gap:6px;padding:10px;min-width:0;border:1px solid var(--community-border);border-radius:12px;overflow:hidden;white-space:normal}
.community-theme-gallery>button:first-child{justify-content:center;align-items:center;min-height:140px;border-style:dashed}
.community-theme-gallery>button[aria-pressed=true]{outline:2px solid var(--community-accent);outline-offset:1px}
.community-theme-choice>strong{font-size:13px;margin:4px 3px 0;overflow-wrap:anywhere}
.community-theme-choice>small{font-size:10px;margin:0 3px 4px;overflow-wrap:anywhere}
.community-theme-art{display:grid;grid-template-columns:20% 1fr;grid-template-rows:42px 24px;gap:7px;width:100%;height:92px;padding:10px;background:var(--choice-surface);border:1px solid var(--choice-raised);border-radius:7px;overflow:hidden;pointer-events:none}
.community-theme-mini-sidebar{grid-row:1/3;border-radius:4px;background:var(--choice-raised);border-top:8px solid var(--choice-accent)}
.community-theme-mini-banner{border-radius:4px;background:linear-gradient(115deg,var(--choice-raised),var(--choice-accent));opacity:.9}
.community-theme-mini-card{border-radius:4px;background:var(--choice-raised);border-left:2px solid var(--choice-accent);box-shadow:inset 0 -7px 0 var(--choice-surface)}
.community-appearance-details{padding:24px 0;border-top:1px solid var(--community-border)}
.community-appearance-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 16px;margin-top:20px}
.community-appearance-fields>label{display:flex;flex-direction:column;gap:7px;font-size:12px;font-weight:600;min-width:0}
.community-appearance-fields select,.community-appearance-fields input{width:100%;min-width:0;min-height:38px;font-weight:400}
.community-appearance-fields input[type=color]{padding:4px;cursor:pointer}
.community-space-customizer>.community-studio-actions{bottom:-40px;margin-top:12px}
.ch-theme-preview{container-type:inline-size;color:var(--community-text);background:var(--community-surface);font-family:var(--community-font-body);font-size:var(--community-font-size);padding:24px;overflow:hidden;transition:max-width .15s ease}
.ch-theme-preview>section,.ch-theme-preview>nav{margin-top:16px}
.ch-theme-preview [data-community-slot=banner]{padding:24px;border-radius:var(--community-radius)}
.ch-theme-preview [data-community-slot=navigation]{display:flex;gap:8px;flex-wrap:wrap;padding:8px 0}
.ch-theme-preview [data-community-slot=message]{margin:12px 0;padding:12px;border-radius:var(--community-radius)}
.ch-theme-preview [data-community-slot=input]{display:block;width:100%;margin-top:12px}
.ch-theme-preview [data-community-slot=heading]{font-family:var(--community-font-heading)}
.ch-theme-preview-layout{display:grid;grid-template-columns:110px minmax(0,1fr);gap:20px;margin-top:20px}
.ch-theme-preview .ch-theme-preview-navigation{display:flex;flex-direction:column;align-items:flex-start;gap:12px;font-size:12px;padding:12px}
.ch-theme-preview-body{min-width:0}
.ch-theme-preview .ch-theme-preview-body>.ch-card{margin-top:0}
.ch-theme-preview-composer{display:flex;align-items:center;gap:8px;margin-top:16px}
.ch-theme-preview .ch-theme-preview-composer input{width:0;min-width:0;flex:1;margin:0}
.ch-theme-preview[data-room-layout=compact] .ch-theme-preview-message{padding:6px 8px}
.ch-theme-preview[data-home-layout=compact] .ch-theme-preview-hero{padding:12px}
.ch-theme-preview[data-home-layout=compact] .ch-theme-preview-hero h3{font-size:18px}
.ch-theme-preview[data-home-layout=banner] .ch-theme-preview-hero{padding:32px 24px;min-height:145px}
.ch-theme-preview[data-home-layout=banner] .ch-theme-preview-hero h3{font-size:28px;margin:8px 0}
.ch-theme-preview[data-home-layout=split]{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:20px;align-items:start}
.ch-theme-preview[data-home-layout=split] .ch-theme-preview-layout{margin-top:0;grid-template-columns:1fr}
.ch-theme-preview[data-home-layout=split] .ch-theme-preview-navigation{flex-direction:row;flex-wrap:wrap}
@container(max-width:500px){.ch-theme-preview-layout{grid-template-columns:1fr;gap:12px}.ch-theme-preview .ch-theme-preview-navigation{flex-direction:row;flex-wrap:wrap;gap:12px;padding:8px}}
@container(max-width:500px){.ch-theme-preview-hero,.ch-theme-preview-layout{grid-column:1/-1}}
.ch-theme-preview[data-community-preview-width=narrow]{margin-left:auto;margin-right:auto;padding:16px}
.ch-content .ch-home-hero{padding:32px;margin-bottom:28px;border-radius:var(--community-radius)}
.ch-content .ch-home-hero h2,.ch-content .ch-banner h2{font-size:clamp(28px,4vw,46px);margin:12px 0}
.ch-content .ch-destinations{gap:var(--community-spacing)}
.ch-content .ch-destination{border-radius:var(--community-radius);transition:border-color .15s ease}
.ch-content .ch-history{font-family:var(--community-font-body);font-size:var(--community-font-size)}
.ch-content .ch-message p{font-size:var(--community-font-size,14px)}
.ch-content .ch-history [data-community-slot=message]{margin:6px 0;border-radius:var(--community-radius)}
@media(max-width:900px){.community-appearance-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.community-theme-gallery{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:1100px){.ch-appearance-workbench{grid-template-columns:1fr}.ch-appearance-workbench>.ch-theme-preview{position:static;order:-1;margin-top:12px}}
@media(max-width:500px){.community-appearance-header{flex-direction:column;gap:8px}.community-appearance-header>button{margin-top:0}.community-appearance-fields{grid-template-columns:1fr}.community-theme-gallery{gap:8px}.community-theme-gallery>button{padding:7px}.community-space-customizer>.community-studio-actions{bottom:-32px}.ch-content .ch-home-hero{padding:20px}}
@media(max-width:500px){.ch-appearance-workbench .community-appearance-fields{grid-template-columns:1fr}.ch-appearance-workbench{gap:12px}}
@media(prefers-reduced-motion:reduce){.ch-theme-preview,.ch-content .ch-destination{transition:none}}
`;

  const shapes = {
    hash: [['path', {d:'M8 3 6 21M18 3l-2 18M3 9h18M2 15h18'}]],
    voice: [['path', {d:'m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14'}]],
    folder: [['path', {d:'M3 5h6l2 2h10v12H3V5Z'}]],
    space: [['rect', {x:3,y:3,width:7,height:7,rx:1.5}],['rect', {x:14,y:3,width:7,height:7,rx:1.5}],['rect', {x:3,y:14,width:7,height:7,rx:1.5}],['rect', {x:14,y:14,width:7,height:7,rx:1.5}]],
    chevron: [['path', {d:'m9 5 7 7-7 7'}]],
    plus: [['path', {d:'M12 5v14M5 12h14'}]],
    settings: [['path', {d:'m10 3-.7 2.3-2 .9-2.2-.6-2 3.4 1.6 1.7v2.6L3.1 15l2 3.4 2.2-.6 2 .9L10 21h4l.7-2.3 2-.9 2.2.6 2-3.4-1.6-1.7v-2.6l1.6-1.7-2-3.4-2.2.6-2-.9L14 3h-4Z'}],['circle', {cx:12,cy:12,r:3}]],
    close: [['path', {d:'m6 6 12 12M6 18 18 6'}]],
    menu: [['path', {d:'M4 6h16M4 12h16M4 18h16'}]],
    send: [['path', {d:'m3 3 19 9-19 9 4-9-4-9Zm4 9h15'}]],
    mic: [['rect', {x:9,y:2,width:6,height:13,rx:3}],['path', {d:'M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8'}]],
    'mic-off': [['path', {d:'m2 2 20 20M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v5M5 10v2a7 7 0 0 0 12 5m2-5v-2M12 19v3M8 22h8'}]],
    disconnect: [['path', {d:'M3 15v-4a17 17 0 0 1 18 0v4h-5v-3a12 12 0 0 0-8 0v3H3Z'}]],
    home: [['path', {d:'m3 10 9-7 9 7v11h-6v-7H9v7H3V10Z'}]],
    'arrow-left': [['path', {d:'m10 5-7 7 7 7M3 12h18'}]],
    search: [['circle', {cx:10.5,cy:10.5,r:6.5}],['path', {d:'m16 16 5 5'}]],
    check: [['path', {d:'m5 12 4 4L19 6'}]],
    globe: [['circle', {cx:12,cy:12,r:9}],['path', {d:'M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z'}]],
    lock: [['rect', {x:5,y:10,width:14,height:11,rx:2}],['path', {d:'M8 10V6a4 4 0 0 1 8 0v4M12 14v3'}]],
    more: [['circle', {cx:5,cy:12,r:1}],['circle', {cx:12,cy:12,r:1}],['circle', {cx:19,cy:12,r:1}]]
  };

  function icon(document, name) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    const attributes = {class:'ch-icon', viewBox:'0 0 24 24', width:'20', height:'20', fill:'none', stroke:'currentColor', 'stroke-width':'1.7', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true', focusable:'false'};
    for (const [attribute, value] of Object.entries(attributes)) svg.setAttribute(attribute, value);
    const definition = Object.prototype.hasOwnProperty.call(shapes, name) ? shapes[name] : shapes.hash;
    for (const [tag, values] of definition) {
      const shape = document.createElementNS(namespace, tag);
      for (const [attribute, value] of Object.entries(values)) shape.setAttribute(attribute, String(value));
      svg.append(shape);
    }
    return svg;
  }

  window.VumiroCommunityUI = {css, icon};
})();
