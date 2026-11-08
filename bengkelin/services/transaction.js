async function withTransaction(database,action,{attempts=3}={}){
 for(let attempt=0;attempt<attempts;attempt++){
  const connection=await database.getConnection();let retry=false;
  try{await connection.beginTransaction();const result=await action(connection);await connection.commit();return result;}
  catch(error){await connection.rollback().catch(()=>{});retry=['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code)&&attempt+1<attempts;if(!retry)throw error;}
  finally{connection.release();}
  if(retry)await new Promise(resolve=>setTimeout(resolve,30*(attempt+1)));
 }
}
module.exports={withTransaction};
