const EVENTS=new Set(['preview','acquisition','application','slot-failure','expiration-fallback','publication','refund','dispute','reconciliation-failure']);
export async function recordMarketplaceMetric(db,event,itemId='all'){
  if(!EVENTS.has(event))throw Error('Unsupported marketplace metric');
  if(typeof itemId!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(itemId))throw Error('Invalid metric item');
  const day=new Date().toISOString().slice(0,10);
  await db.prepare('INSERT INTO marketplace_metrics(day,event,item_id,count) VALUES(?,?,?,1) ON CONFLICT(day,event,item_id) DO UPDATE SET count=MIN(count+1,1000000000)').bind(day,event,itemId).run();
}
export async function readMarketplaceMetrics(db){
  const result=await db.prepare('SELECT day,event,item_id,count FROM marketplace_metrics WHERE day>=date(\'now\',\'-90 days\') ORDER BY day DESC,event,item_id LIMIT 10000').all();
  return result.results;
}
