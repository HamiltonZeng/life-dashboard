import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadAppProfile} from '../apps/api/src/profile.js';
test('release profile defaults to mvp and rejects unknown values',()=>{
  const old=process.env.APP_PROFILE;delete process.env.APP_PROFILE;
  try {assert.equal(loadAppProfile(),'mvp');assert.equal(loadAppProfile('development'),'development');assert.throws(()=>loadAppProfile(''));assert.throws(()=>loadAppProfile('production'));}finally{if(old===undefined)delete process.env.APP_PROFILE;else process.env.APP_PROFILE=old;}
});
