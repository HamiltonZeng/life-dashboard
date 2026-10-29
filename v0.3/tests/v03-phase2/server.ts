import {syntheticRuntime} from './runtime.js';
import {buildApp} from '../../apps/api/src/app.js';
const {pool,service}=syntheticRuntime(),app=await buildApp(pool,{planning:service,profile:'mvp',origin:'http://gateway-test'});await app.listen({host:'0.0.0.0',port:3001});
