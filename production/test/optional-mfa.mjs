// Explicit verified-factor enrollment for tests which exercise opted-in MFA.
// Baseline synthetic accounts stay password-only, matching the product default.
export async function withVerifiedFactor(db,user,run){
 const {rows}=await db.query("insert into auth.mfa_factors(id,user_id,status) values(gen_random_uuid(),$1,'verified') returning id",[user]);
 try{return await run();}finally{await db.query('delete from auth.mfa_factors where id=$1',[rows[0].id]);}
}
