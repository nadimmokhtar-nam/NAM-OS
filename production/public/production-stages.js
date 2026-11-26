// New work uses NAM's agreed workflow. Historical task stages remain valid.
const canonical=['Briefing','Modelling','Camera approval','Materials and lighting','Draft production','Internal review','Client review','Revisions','Final approval','Delivery'];
const legacy=['Brief','Materials','Lighting'];
export function productionStages(current=''){return [...canonical,...(legacy.includes(current)?[current]:[])];}
export function isProductionStage(value){return typeof value==='string'&&(canonical.includes(value)||legacy.includes(value));}
