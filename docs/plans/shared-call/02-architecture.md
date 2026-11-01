# Architecture

Add a WebView2 Call tab using packaged static files at a secure virtual origin. It connects to a configurable public WSS endpoint. A compatible local `/call-signaling` endpoint supports tests and existing host setups. A Cloudflare Worker serves only the new room UI and a Durable Object routes JSON signaling among up to eight peers. Media remains on direct WebRTC mesh connections; no TURN is configured.

Protocol: welcome(id, peers), peer-joined(id,name), peer-left(id), signal(to,description/candidate) with a server-assigned from. Names and messages are bounded; room membership limits and sender isolation apply. Each peer owns its capture and media connections. Closing a share leaves room membership intact.
