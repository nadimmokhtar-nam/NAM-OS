import type {ProviderConfig,Snapshot,TransportOptions} from './types';
export function attioSnapshot(config:ProviderConfig,options?:TransportOptions):Promise<Snapshot>;
export function lemlistSnapshot(config:ProviderConfig,options?:TransportOptions):Promise<Snapshot>;
export function justcallSnapshot(config:ProviderConfig,options?:TransportOptions):Promise<Snapshot>;
