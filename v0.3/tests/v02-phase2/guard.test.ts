import {test} from 'node:test';
import assert from 'node:assert/strict';
test('phase-two acceptance must be explicitly bound to the Codex synthetic database',()=>{
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DATABASE_HOST,'postgres-test');assert.equal(process.env.DATABASE_NAME,'life_dashboard_v03_test');assert.equal(process.env.PHASE2_ACCEPTANCE,'codex');
});
