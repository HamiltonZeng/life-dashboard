import assert from 'node:assert/strict';
export function guardSynthetic(){
 for(const [key,value] of Object.entries({NODE_ENV:'test',PHASE3_ACCEPTANCE:'codex-phase3',ACCEPTANCE_PROJECT:'life-dashboard-v0-2-codex',DATABASE_HOST:'postgres-test',DATABASE_NAME:'life_dashboard_test'}))assert.equal(process.env[key],value,'Refuse destructive acceptance outside the Codex synthetic environment: '+key);
}
