const $ = s => document.querySelector(s);
let currentUser = null;
const pages = ['home','auth','jobs','postJob','applications','notifications','dashboard'];
async function api(url, options={}) {
  const opts = { credentials:'same-origin', ...options, headers:{ ...(options.headers||{}) } };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const response = await fetch(url, opts);
  const data = response.status === 204 ? {} : await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function message(text, isError=false) {
  const el = $('#message'); el.textContent=text; el.classList.remove('hidden','error');
  if(isError) el.classList.add('error');
  window.scrollTo({top:0,behavior:'smooth'});
  setTimeout(()=>el.classList.add('hidden'),4500);
}
function showPage(id) {
  pages.forEach(p=>$('#'+p).classList.toggle('hidden',p!==id));
  if(id==='jobs') loadJobs();
  if(id==='applications') loadApplications();
  if(id==='notifications') loadNotifications();
  if(id==='postJob') loadRecruiterJobs();
  if(id==='dashboard') loadDashboard();
  window.scrollTo({top:0,behavior:'smooth'});
}
function renderNav() {
  const nav = $('#nav');
  if (!currentUser) {
    nav.innerHTML = `<button onclick="showPage('jobs')">Browse jobs</button><button onclick="showPage('auth')">Login / Register</button>`;
    return;
  }
  let html = `<button onclick="showPage('dashboard')">Dashboard</button><button onclick="showPage('jobs')">Jobs</button>`;
  if (currentUser.role === 'JOB_SEEKER') html += `<button onclick="showPage('applications')">My Applications</button>`;
  if (currentUser.role === 'RECRUITER') html += `<button onclick="showPage('postJob')">Manage Jobs</button>`;
  html += `<button onclick="showPage('notifications')">Notifications</button><button onclick="logout()">Logout</button>`;
  nav.innerHTML = html;
}
async function refreshUser(){const d=await api('/api/me');currentUser=d.user;renderNav();}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();try{const f=new FormData(e.target);const d=await api('/api/login',{method:'POST',body:Object.fromEntries(f)});currentUser=d.user;renderNav();message('Welcome back, '+currentUser.name+'!');showPage('dashboard');}catch(err){message(err.message,true);}});
$('#registerForm').addEventListener('submit',async e=>{e.preventDefault();try{const f=new FormData(e.target);const d=await api('/api/register',{method:'POST',body:Object.fromEntries(f)});currentUser=d.user;renderNav();message('Account created successfully.');showPage('dashboard');}catch(err){message(err.message,true);}});
async function logout(){try{await api('/api/logout',{method:'POST'});currentUser=null;renderNav();showPage('home');message('You have logged out.');}catch(e){message(e.message,true);}}
$('#searchForm').addEventListener('submit',e=>{e.preventDefault();loadJobs(new FormData(e.target).get('q'));});
async function loadJobs(q=''){
  const list=$('#jobList');list.innerHTML='<div class="empty">Loading jobs…</div>';
  try{const d=await api('/api/jobs?q='+encodeURIComponent(q));if(!d.jobs.length){list.innerHTML='<div class="empty">No jobs found. Try another search.</div>';return;}
  list.innerHTML=d.jobs.map(j=>`<article class="job-card"><span class="tag">${esc(j.location)}</span><h3>${esc(j.title)}</h3><div class="company">${esc(j.company)}</div><p>${esc(j.description.slice(0,180))}${j.description.length>180?'…':''}</p><p><b>Skills:</b> ${esc(j.skills||'Not specified')}</p><small class="muted">Posted by ${esc(j.recruiter_name||'Recruiter')}</small><div class="job-actions"><button onclick="applyJob(${j.id})">Apply now</button><button class="outline" onclick="viewJob(${j.id})">Details</button>${currentUser?.role==='RECRUITER'&&currentUser.id===j.recruiter_id?`<button class="outline" onclick="viewApplicants(${j.id})">Applicants</button>`:''}</div></article>`).join('');
  }catch(e){list.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
}
async function viewJob(id){try{const d=await api('/api/jobs/'+id);alert(`${d.job.title}\n${d.job.company} · ${d.job.location}\n\n${d.job.description}\n\nSkills: ${d.job.skills||'Not specified'}`);}catch(e){message(e.message,true);}}
async function applyJob(jobId){if(!currentUser){message('Please log in as a Job Seeker to apply.',true);showPage('auth');return;}if(currentUser.role!=='JOB_SEEKER'){message('Only job seekers can apply.',true);return;}try{await api('/api/applications',{method:'POST',body:{jobId}});message('Application submitted successfully.');}catch(e){message(e.message,true);}}
$('#jobForm').addEventListener('submit',async e=>{e.preventDefault();try{const f=new FormData(e.target);await api('/api/jobs',{method:'POST',body:Object.fromEntries(f)});e.target.reset();message('Job published successfully.');loadRecruiterJobs();}catch(err){message(err.message,true);}});
async function loadRecruiterJobs(){const el=$('#recruiterJobs');try{const d=await api('/api/jobs');const mine=d.jobs.filter(j=>j.recruiter_id===currentUser?.id);if(!mine.length){el.innerHTML='<div class="empty">You have not posted any jobs yet.</div>';return;}el.innerHTML=mine.map(j=>`<div class="notice"><b>${esc(j.title)}</b> · ${esc(j.company)}<div class="job-actions"><button class="outline" onclick="viewApplicants(${j.id})">View applicants</button></div><div id="applicants-${j.id}"></div></div>`).join('');}catch(e){el.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}}
async function viewApplicants(jobId){try{const d=await api('/api/jobs/'+jobId+'/applicants');const el=$('#applicants-'+jobId)||$('#recruiterJobs');const rows=d.applicants.map(a=>`<div class="applicant-row"><span><b>${esc(a.name)}</b><br><small>${esc(a.email)} · ${esc(a.applied_at)}</small></span><span><select onchange="updateStatus(${a.id},this.value)">${['APPLIED','REVIEWING','SHORTLISTED','REJECTED'].map(s=>`<option ${a.status===s?'selected':''}>${s}</option>`).join('')}</select></span></div>`).join('');el.innerHTML=rows||'<div class="empty">No applicants yet.</div>';}catch(e){message(e.message,true);}}
async function updateStatus(id,status){try{await api('/api/applications/'+id+'/status',{method:'PATCH',body:{status}});message('Application status updated.');}catch(e){message(e.message,true);}}
async function loadApplications(){const el=$('#applicationList');try{const d=await api('/api/applications/mine');if(!d.applications.length){el.innerHTML='<div class="empty">You have not applied for any jobs yet.</div>';}else{el.innerHTML='<div class="table-wrap"><table><thead><tr><th>Job</th><th>Company</th><th>Location</th><th>Applied on</th><th>Status</th></tr></thead><tbody>'+d.applications.map(a=>`<tr><td>${esc(a.job_title)}</td><td>${esc(a.company)}</td><td>${esc(a.location)}</td><td>${esc(a.applied_at)}</td><td><span class="status">${esc(a.status)}</span></td></tr>`).join('')+'</tbody></table></div>';}const r=await api('/api/resumes/mine');$('#resumeList').innerHTML=r.resumes.length?r.resumes.map(x=>`<p>📄 ${esc(x.original_name)} <small class="muted">(${esc(x.uploaded_at)})</small></p>`).join(''):'<p class="muted">No resumes uploaded yet.</p>';}catch(e){el.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}}
$('#resumeForm').addEventListener('submit',async e=>{e.preventDefault();try{const fd=new FormData(e.target);const d=await api('/api/resumes',{method:'POST',body:fd});message('Resume uploaded: '+d.resume.originalName);e.target.reset();loadApplications();}catch(err){message(err.message,true);}});
async function loadNotifications(){const el=$('#notificationList');try{const d=await api('/api/notifications');if(!d.notifications.length){el.innerHTML='<div class="empty">No notifications yet.</div>';return;}el.innerHTML=d.notifications.map(n=>`<article class="notice ${n.is_read?'':'unread'}"><p>${esc(n.message)}</p><small>${esc(n.created_at)} · ${n.is_read?'Read':'Unread'}</small>${n.is_read?'':` <button class="outline" onclick="markRead(${n.id})">Mark read</button>`}</article>`).join('');}catch(e){el.innerHTML='<div class="empty">'+esc(e.message)+'</div>';}}
async function markRead(id){try{await api('/api/notifications/'+id+'/read',{method:'PATCH'});loadNotifications();}catch(e){message(e.message,true);}}
function loadDashboard(){if(!currentUser){showPage('auth');return;}$('#dashboardTitle').textContent='Hello, '+currentUser.name;$('#dashboardText').textContent=currentUser.role==='RECRUITER'?'Create job listings and manage candidates who apply.':'Search jobs, submit applications and follow their progress.';$('#dashApply').classList.toggle('hidden',currentUser.role!=='JOB_SEEKER');$('#dashPost').classList.toggle('hidden',currentUser.role!=='RECRUITER');}
(async()=>{try{await refreshUser();}catch(e){}renderNav();showPage('home');})();
