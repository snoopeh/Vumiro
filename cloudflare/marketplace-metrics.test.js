import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
test('aggregate marketplace telemetry excludes private hub content and arbitrary payloads',async()=>{
  const file=new URL('./marketplace-metrics.js',import.meta.url);assert.ok(fs.existsSync(file),'aggregate metrics boundary exists');
  const {recordMarketplaceMetric}=await import(file);const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('./marketplace-migrations/0003_metrics.sql',import.meta.url),'utf8'));
  const prepare=(sql,values=[])=>({bind(...args){return prepare(sql,args);},run(){return sqlite.prepare(sql).run(...values);}});const db={prepare};
  try{
    await recordMarketplaceMetric(db,'preview','oak-frames');await recordMarketplaceMetric(db,'preview','oak-frames');
    assert.equal(sqlite.prepare('SELECT count FROM marketplace_metrics').get().count,2);
    await assert.rejects(()=>recordMarketplaceMetric(db,'private-message','hello'),/metric/);
    await assert.rejects(()=>recordMarketplaceMetric(db,'preview',{conversation:'private'}),/item/);
    const columns=sqlite.prepare('PRAGMA table_info(marketplace_metrics)').all().map(row=>row.name);
    assert.deepEqual(columns,['day','event','item_id','count']);
  }finally{sqlite.close();}
});
