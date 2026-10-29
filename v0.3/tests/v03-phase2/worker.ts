import {syntheticRuntime} from './runtime.js';
const {service}=syntheticRuntime();while(true){try{await service.tick();await service.reports.scheduleTick();await service.reports.tick();}catch{console.error('Synthetic worker iteration failed.');}await new Promise(r=>setTimeout(r,200));}
