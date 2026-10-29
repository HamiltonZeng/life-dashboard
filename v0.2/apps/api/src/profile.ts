export type AppProfile='mvp'|'development';
export function loadAppProfile(value: string|undefined=process.env.APP_PROFILE):AppProfile {
  if(value===undefined || value==='mvp')return 'mvp';
  if(value==='development')return value;
  throw new Error('APP_PROFILE must be mvp or development');
}
