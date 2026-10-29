import assert from 'node:assert/strict';
export function guardSynthetic(){
 for(const [key,value] of Object.entries({NODE_ENV:'test',PHASE3_ACCEPTANCE:'codex-phase3',ACCEPTANCE_PROJECT:'life-dashboard-v0-3',DATABASE_HOST:'postgres-test',DATABASE_NAME:'life_dashboard_v03_test'}))assert.equal(process.env[key],value,'Refuse destructive acceptance outside the Codex synthetic environment: '+key);
}
