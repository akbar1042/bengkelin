const express=require('express'),bcrypt=require('bcrypt'),crypto=require('node:crypto');
const db=require('../../db'),partners=require('../repositories/partners');
const {bad}=require('../lib/workshop-utils'),{validateRegistration,TERMS_VERSION}=require('../lib/partner-input');
const object=value=>typeof value==='string'?JSON.parse(value):value||{};
const parseId=value=>{const id=Number(String(value).replace(/^partner:/,''));if(!Number.isSafeInteger(id)||id<1)throw bad('ID tidak valid.');return id;};
const transitions={waiting:['accepted','cancelled'],accepted:['processing','cancelled'],processing:['completed','cancelled'],completed:[],cancelled:[]};
function scheduledTime(value,hours,open24,now=Date.now(),duration=60){
 if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value))throw bad('Jadwal harus menyertakan zona waktu.');
 const date=new Date(value);if(!Number.isFinite(date.getTime())||date.getTime()<now+15*60000||date.getTime()>now+90*86400000)throw bad('Jadwal minimal 15 menit dari sekarang dan maksimal 90 hari.');
 if(!hours?.days?.length)throw bad('Bengkel belum melengkapi jam operasional. Hubungi bengkel.');
 const local=new Date(date.getTime()+7*3600000),day=local.getUTCDay(),minute=local.getUTCHours()*60+local.getUTCMinutes();
 const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
 const start=minutes(hours.open),end=minutes(hours.close);
 const inside=open24?hours.days.includes(day):start<end?hours.days.includes(day)&&minute>=start&&minute+duration<=end:(hours.days.includes(day)&&minute>=start&&minute+duration<=1440+end)||(hours.days.includes((day+6)%7)&&minute+duration<=end);
 if(!inside)throw bad('Slot servis sesuai durasi layanan berada di luar jam operasional bengkel (WIB).');
 return date.toISOString().slice(0,19).replace('T',' ');
}
function createCommerceRouter({database=db}={}){
 const r=express.Router();r.use('/api/customer/orders',async(req,res,next)=>{try{await require('../services/operations').maintain(database);next();}catch(e){next(e)}});r.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const customer=(req,res,next)=>req.account.role==='customer'?next():res.status(403).json({message:'Fitur ini untuk akun pelanggan.'});
 const admin=(req,res,next)=>req.account.role==='admin'?next():res.status(403).json({message:'Hanya admin.'});
 const transaction=action=>require('../services/transaction').withTransaction(database,action);
 async function workshop(c,id,lock=false){const [rows]=await c.execute('SELECT p.*,d.details FROM partner_workshops p LEFT JOIN partner_workshop_details d ON d.workshop_id=p.id WHERE p.id=?'+(lock?' FOR UPDATE':''),[id]);if(!rows[0])throw bad('Bengkel tidak ditemukan.',404);return rows[0];}
 r.get('/api/customer/partners/:id',async(req,res)=>{
  if (req.account.role === 'partner') throw bad('Fitur ini untuk akun pelanggan.', 403);
  const id=parseId(req.params.id),p=await partners.getApproved(id);if(!p)return res.status(404).json({message:'Mitra tidak ditemukan atau belum disetujui.'});
  const [reviews]=await database.execute("SELECT r.id,r.rating,r.content,r.created_at FROM service_reviews r WHERE r.workshop_id=? AND r.status='approved' ORDER BY r.id DESC LIMIT 100",[id]);
  const [f]=await database.execute('SELECT 1 FROM workshop_favorites WHERE user_id=? AND workshop_id=?',[req.account.id,id]);
  res.json({workshop:p,reviews,favorite:f.length>0});
 });
 r.get('/api/customer/favorites',customer,async(req,res)=>{const [rows]=await database.execute('SELECT f.workshop_id,p.name,p.address,p.status FROM workshop_favorites f JOIN partner_workshops p ON p.id=f.workshop_id WHERE f.user_id=? ORDER BY f.created_at DESC',[req.account.id]);res.json({data:rows});});
 r.put('/api/customer/favorites/:id',customer,async(req,res)=>{const id=parseId(req.params.id),p=await partners.getApproved(id);if(!p)throw bad('Mitra belum tersedia.',404);await database.execute('INSERT IGNORE INTO workshop_favorites(user_id,workshop_id) VALUES (?,?)',[req.account.id,id]);res.json({message:'Disimpan ke favorit.'});});
 r.delete('/api/customer/favorites/:id',customer,async(req,res)=>{await database.execute('DELETE FROM workshop_favorites WHERE user_id=? AND workshop_id=?',[req.account.id,parseId(req.params.id)]);res.json({message:'Favorit dihapus.'});});
 r.post('/api/customer/orders',customer,async(req,res)=>{
  const body=req.body||{},id=parseId(body.workshopId);if(!['motor','mobil'].includes(body.vehicleType)||typeof body.service!=='string'||typeof(body.notes??'')!=='string'||(body.notes||'').length>1500)throw bad('Kategori kendaraan, layanan atau catatan tidak valid.');
  const orderId=await transaction(async c=>{
   const [customers]=await c.execute('SELECT id FROM users WHERE id=? AND deleted_at IS NULL FOR UPDATE',[req.account.id]);if(!customers.length)throw bad('Akun tidak tersedia.',401);
   const w=await workshop(c,id,true),d=object(w.details);if(w.status!=='approved'||w.owner_user_id===req.account.id)throw bad('Bengkel tidak menerima pemesanan ini.');
   if(!d.vehicleTypes?.includes(body.vehicleType)||!object(w.services).includes(body.service))throw bad('Kategori kendaraan atau layanan tidak ditangani bengkel.');
   const duration=d.booking?.durations?.[body.service]||60,capacity=d.booking?.capacity||1;
   const time=scheduledTime(body.scheduledAt,d.hours,w.open24,Date.now(),duration);
   const [conflicts]=await c.execute("SELECT scheduled_at,duration_minutes FROM service_orders WHERE workshop_id=? AND status IN ('waiting','accepted','processing') AND scheduled_at<DATE_ADD(?,INTERVAL ? MINUTE) AND DATE_ADD(scheduled_at,INTERVAL duration_minutes MINUTE)>?",[id,time,duration,time]);
   const start=Date.parse(time.replace(' ','T')+'Z'),end=start+duration*60000;const edges=[[start,1],[end,-1]];
   for(const other of conflicts){const begin=new Date(other.scheduled_at).getTime();edges.push([Math.max(start,begin),1],[Math.min(end,begin+other.duration_minutes*60000),-1]);}
   edges.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let simultaneous=0;for(const [,delta]of edges){simultaneous+=delta;if(simultaneous>capacity)throw bad('Kapasitas bengkel pada jadwal ini sudah penuh. Pilih waktu lain.',409);}
   const [created]=await c.execute('INSERT INTO service_orders(customer_id,workshop_id,vehicle_type,service,scheduled_at,notes,duration_minutes) VALUES (?,?,?,?,?,?,?)',[req.account.id,id,body.vehicleType,body.service,time,(body.notes||'').trim(),duration]);
   await c.execute("INSERT INTO service_order_events(order_id,actor_id,status) VALUES (?,?,'waiting')",[created.insertId,req.account.id]);return created.insertId;
  });res.status(201).json({id:orderId,message:'Pesanan menunggu konfirmasi bengkel. Biaya dikonfirmasi langsung; tidak ada pembayaran online.'});
 });
 const listOrders=owner=>async(req,res)=>{const [rows]=await database.execute("SELECT o.*,p.name AS workshop_name,p.phone AS workshop_phone,u.email AS customer_email,r.id AS review_id,r.status AS review_status FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id JOIN users u ON u.id=o.customer_id LEFT JOIN service_reviews r ON r.order_id=o.id WHERE "+(owner?'p.owner_user_id':'o.customer_id')+'=? ORDER BY o.id DESC LIMIT 300',[req.account.id]);res.json({data:rows.map(o=>({...o,scheduled_at:new Date(o.scheduled_at).toISOString()}))});};
 r.get('/api/customer/orders',customer,listOrders(false));r.get('/api/owner/orders',listOrders(true));
 const canAccessOrder = (order, account) => order && (
  order.owner_user_id === account.id || (account.role !== 'partner' && order.customer_id === account.id)
 );
 r.get('/api/customer/orders/:id/events',async(req,res)=>{const id=parseId(req.params.id);const [orders]=await database.execute('SELECT o.customer_id,p.owner_user_id FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE o.id=?',[id]);if(!canAccessOrder(orders[0], req.account))throw bad('Pesanan tidak ditemukan.',404);const [events]=await database.execute('SELECT status,note,created_at FROM service_order_events WHERE order_id=? ORDER BY id',[id]);res.json({data:events});});
 r.patch('/api/customer/orders/:id/status',async(req,res)=>{
  const id=parseId(req.params.id),body=req.body||{};
  await transaction(async c=>{
   const [rows]=await c.execute('SELECT o.*,p.owner_user_id FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE o.id=? FOR UPDATE',[id]);const order=rows[0];
   if(!canAccessOrder(order, req.account))throw bad('Pesanan tidak ditemukan.',404);
   const owner=order.owner_user_id===req.account.id;
   if(!owner&&(body.status!=='cancelled'||!['waiting','accepted'].includes(order.status)))throw bad('Pelanggan hanya dapat membatalkan pesanan sebelum diproses.',403);
   if(!transitions[order.status].includes(body.status))throw bad('Perubahan status tidak diperbolehkan.',409);
   if(body.status==='processing'&&(order.confirmed_cost==null||order.cost_version<1||order.accepted_cost_version!==order.cost_version))throw bad('Biaya versi terbaru harus disetujui pelanggan sebelum servis diproses.',409);
   if(body.status==='completed'&&new Date(order.scheduled_at).getTime()>Date.now())throw bad('Servis tidak dapat diselesaikan sebelum jadwal.',409);
   const note=body.note??'';if(typeof note!=='string'||note.length>500||(body.status==='cancelled'&&!note.trim()))throw bad('Catatan maksimal 500 karakter; alasan pembatalan wajib diisi.');
   await c.execute('UPDATE service_orders SET status=?,cancellation_reason=? WHERE id=?',[body.status,body.status==='cancelled'?note.trim():order.cancellation_reason,id]);
   await c.execute('INSERT INTO service_order_events(order_id,actor_id,status,note) VALUES (?,?,?,?)',[id,req.account.id,body.status,note.trim()]);
  });res.json({message:'Status pesanan diperbarui.'});
 });
 r.patch('/api/owner/orders/:id/cost',async(req,res)=>{
  const id=parseId(req.params.id),{amount,note}=req.body||{};
  if(!Number.isSafeInteger(amount)||amount<0||amount>1e9||typeof note!=='string'||!note.trim()||note.length>500)throw bad('Isi biaya rupiah dan catatan konfirmasi (maksimal 500 karakter).');
  const [result]=await database.execute("UPDATE service_orders o JOIN partner_workshops p ON p.id=o.workshop_id SET o.confirmed_cost=?,o.cost_note=?,o.cost_version=o.cost_version+1,o.accepted_cost_version=0,o.cost_accepted_at=NULL WHERE o.id=? AND p.owner_user_id=? AND o.status IN ('waiting','accepted')",[amount,note.trim(),id,req.account.id]);if(!result.affectedRows)throw bad('Pesanan tidak tersedia untuk perubahan biaya.',404);res.json({message:'Biaya dicatat. Konfirmasikan kepada pelanggan sebelum pengerjaan.'});
 });
 r.post('/api/customer/orders/:id/review',customer,async(req,res)=>{
  const id=parseId(req.params.id),{rating,content}=req.body||{};if(!Number.isInteger(rating)||rating<1||rating>5||typeof content!=='string'||!content.trim()||content.length>1500)throw bad('Rating 1–5 dan ulasan maksimal 1500 karakter wajib diisi.');
  const [result]=await database.execute("INSERT INTO service_reviews(order_id,customer_id,workshop_id,rating,content) SELECT id,customer_id,workshop_id,?,? FROM service_orders WHERE id=? AND customer_id=? AND status='completed'",[rating,content.trim(),id,req.account.id]);if(!result.affectedRows)throw bad('Ulasan hanya untuk servis Anda yang telah selesai.',403);res.status(201).json({message:'Ulasan menunggu moderasi admin.'});
 });
 r.get('/api/admin/reviews',admin,async(req,res)=>{const [rows]=await database.execute("SELECT r.*,p.name AS workshop_name FROM service_reviews r JOIN partner_workshops p ON p.id=r.workshop_id ORDER BY r.id DESC LIMIT 300");res.json({data:rows});});
 r.patch('/api/admin/reviews/:id',admin,async(req,res)=>{const {status,note}=req.body||{};if(!['approved','rejected'].includes(status)||typeof note!=='string'||!note.trim()||note.length>500)throw bad('Keputusan dan alasan moderasi wajib diisi.');const [result]=await database.execute('UPDATE service_reviews SET status=?,moderation_note=?,moderated_by=? WHERE id=?',[status,note.trim(),req.account.id,parseId(req.params.id)]);if(!result.affectedRows)throw bad('Ulasan tidak ditemukan.',404);res.json({message:'Moderasi disimpan.'});});
 r.get('/api/owner/workshops',async(req,res)=>res.json({data:await partners.mine(req.account.id)}));
 r.put('/api/owner/workshops/:id',async(req,res)=>{
  const id=parseId(req.params.id),input=validateRegistration(req.body);
  const w=await workshop(database,id);if(w.owner_user_id!==req.account.id)throw bad('Bengkel tidak ditemukan.',404);const details=object(w.details);

  await require('../services/revisions').propose(database,id,req.account.id,input);
  res.json({message:'Perubahan profil menunggu peninjauan admin. Profil approved sebelumnya tetap tampil.'});
 });
 r.post('/api/account/password',async(req,res)=>{
  const {currentPassword,password}=req.body||{};if(typeof currentPassword!=='string'||typeof password!=='string'||password.length<8||Buffer.byteLength(password)>72)throw bad('Password baru minimal 8 karakter dan maksimal 72 byte.');
  const [users]=await database.execute('SELECT password_hash FROM users WHERE id=?',[req.account.id]);if(!await bcrypt.compare(currentPassword,users[0].password_hash))throw bad('Password saat ini salah.',403);
  const hash=await bcrypt.hash(password,12);const [updated]=await database.execute('UPDATE users SET password_hash=?,auth_version=auth_version+1 WHERE id=? AND password_hash=?',[hash,req.account.id,users[0].password_hash]);if(!updated.affectedRows)throw bad('Akun berubah. Login kembali.',409);
  req.session.destroy(()=>res.json({message:'Password diganti. Silakan login kembali pada seluruh perangkat.'}));
 });
 r.delete('/api/account',async(req,res)=>{
  const {password,confirmation}=req.body||{};if(confirmation!=='HAPUS AKUN'||typeof password!=='string')throw bad('Password dan konfirmasi HAPUS AKUN wajib diisi.');
  if(req.account.role==='admin')throw bad('Admin harus mencabut role admin sebelum menghapus akun.',409);
  const [users]=await database.execute('SELECT password_hash FROM users WHERE id=?',[req.account.id]);if(!await bcrypt.compare(password,users[0].password_hash))throw bad('Password salah.',403);
  await transaction(async c=>{await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[req.account.id]);
   const [active]=await c.execute("SELECT o.id FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE (o.customer_id=? OR p.owner_user_id=?) AND o.status IN ('accepted','processing') LIMIT 1",[req.account.id,req.account.id]);if(active.length)throw bad('Selesaikan atau batalkan pesanan aktif sebelum menghapus akun.',409);
   await c.execute("INSERT INTO service_order_events(order_id,actor_id,status,note,actor_type) SELECT o.id,?,'cancelled','Akun dinonaktifkan','system' FROM service_orders o JOIN partner_workshops p ON p.id=o.workshop_id WHERE (o.customer_id=? OR p.owner_user_id=?) AND o.status='waiting'",[req.account.id,req.account.id,req.account.id]);
   await c.execute("UPDATE service_orders o JOIN partner_workshops p ON p.id=o.workshop_id SET o.status='cancelled',o.cancellation_reason='Akun dinonaktifkan' WHERE (o.customer_id=? OR p.owner_user_id=?) AND o.status='waiting'",[req.account.id,req.account.id]);
   await c.execute('DELETE FROM workshop_favorites WHERE user_id=?',[req.account.id]);
   await c.execute('SELECT id FROM partner_workshops WHERE owner_user_id=? ORDER BY id FOR UPDATE',[req.account.id]);
   await c.execute("UPDATE workshop_revisions r JOIN partner_workshops p ON p.id=r.workshop_id SET r.status='rejected',r.note='Akun pemilik dinonaktifkan',r.reviewed_by=NULL WHERE p.owner_user_id=? AND r.status='pending'",[req.account.id]);
   await c.execute("UPDATE partner_workshops SET status='rejected',review_note='Akun pemilik dinonaktifkan' WHERE owner_user_id=?",[req.account.id]);
   await c.execute('UPDATE users SET email=?,password_hash=?,auth_version=auth_version+1,deleted_at=UTC_TIMESTAMP() WHERE id=?',[`deleted-${req.account.id}-${crypto.randomBytes(8).toString('hex')}@invalid.local`,crypto.randomBytes(32).toString('hex'),req.account.id]);
  });req.session.destroy(()=>res.json({message:'Akun dinonaktifkan dan email login dianonimkan. Riwayat pesanan disimpan untuk integritas catatan layanan.'}));
 });
 r.get('/api/map-config',(req,res)=>res.json({browserKey:process.env.GOOGLE_MAPS_BROWSER_KEY||null}));
 r.use((error,req,res,next)=>{if(error.code==='ER_DUP_ENTRY')return res.status(409).json({message:'Data sudah tercatat; satu ulasan hanya boleh untuk satu pesanan.'});if(error.status)return res.status(error.status).json({message:error.message});next(error);});
 return r;
}
module.exports={createCommerceRouter,scheduledTime,transitions};
