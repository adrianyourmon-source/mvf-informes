// Mobile shell: keeps the existing controls and their event handlers.
function scalePreview(){const paper=$('paper'),frame=$('paperFrame');if(!frame||activeView!=='preview')return;const scale=Math.min(1,frame.clientWidth/794);paper.style.transform=`scale(${scale})`;frame.style.height=Math.ceil(paper.scrollHeight*scale)+'px'}
(() => {
  const header=document.querySelector('header'),control=document.querySelector('.employeecontrol');
  const logo=document.querySelector('.brand-logo');header.replaceChildren();
  const brand=document.createElement('a');brand.className='compact-brand';brand.href='#';brand.setAttribute('aria-label','MVF Informes: ir al informe');brand.append(logo);brand.onclick=e=>{e.preventDefault();showView('editor')};
  $('employeeSelect').setAttribute('aria-label','Empleado activo');
  $('addEmployee').textContent='+';$('addEmployee').setAttribute('aria-label','Agregar empleado');$('addEmployee').title='Agregar empleado';
  const employeeLabel=$('employeeSelect').parentElement;employeeLabel.firstChild.textContent='';
  const topActions=document.createElement('div');topActions.className='top-actions';
  $('newReport').textContent='+ Nuevo informe';$('newReport').className='secondary';topActions.append($('driveStatus'));
  header.append(brand,control,topActions);
  const nav=document.querySelector('.workspacetabs');nav.className='bottom-nav';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Navegación principal');
  const previewButton=document.createElement('button');previewButton.type='button';previewButton.id='showPreview';previewButton.onclick=()=>{showView('preview');window.scrollTo(0,0)};
  $('showEditor').after(previewButton);
  const icons={showEditor:'<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>',showPreview:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',showHistory:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>'};
  for(const [id,label] of [['showEditor','Informe'],['showPreview','Vista previa'],['showHistory','Historial']]){const el=$(id);el.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[id]}</svg><span>${label}</span>`;el.setAttribute('role','tab');el.setAttribute('aria-controls',id==='showEditor'?'editorView':id==='showHistory'?'historyView':'previewView')}
  document.body.append(nav);document.querySelector('.workspacebar').remove();
  const preview=document.querySelector('.preview');preview.id='previewView';preview.hidden=true;$('editorView').after(preview);
  const frame=document.createElement('div');frame.id='paperFrame';$('paper').before(frame);frame.append($('paper'));
  const actions=document.querySelector('.actions');actions.className='fixed-actions';actions.setAttribute('aria-label','Acciones del informe');
  $('saveReport').textContent='Guardar';$('saveReport').setAttribute('aria-label','Guardar en historial');$('teamSend').textContent='Pendientes';$('teamSend').setAttribute('aria-label','Enviar a pendientes del equipo');$('driveSend').className='secondary';
  actions.append($('newReport'));document.body.append(actions);document.querySelector('.note')?.remove();
  const top=document.querySelector('.top');const title=document.createElement('h1');title.textContent='Informe de servicio';top.replaceChildren(title,$('reportStatus'));
  document.querySelectorAll('.panel > .section').forEach(section=>{const details=document.createElement('details');details.className='section';details.open=!!section.querySelector('#tasks');const summary=document.createElement('summary'),heading=section.querySelector('.sectionhead');summary.append(...heading.childNodes);heading.remove();const check=document.createElement('span');check.className='section-check';check.setAttribute('aria-label','Con datos');summary.append(check);const body=document.createElement('div');body.className='section-body';body.append(...section.childNodes);details.append(summary,body);section.replaceWith(details)});
  $('objective').setAttribute('aria-label','Objetivo o motivo de intervención');$('recommendations').setAttribute('aria-label','Recomendaciones');
  const localTitle=document.querySelector('.mine-title'),list=$('historyList'),teamHead=document.querySelector('.team-head'),teamList=$('teamList');
  const history=$('historyView');history.append(localTitle,list,teamHead,teamList);
  const overlay=document.createElement('div');overlay.id='busyOverlay';overlay.hidden=true;overlay.setAttribute('role','status');overlay.setAttribute('aria-live','polite');overlay.innerHTML='<div class="busy-card"><span class="busy-spinner"></span><strong id="busyText">Procesando…</strong></div>';
  const viewer=document.createElement('dialog');viewer.id='photoViewer';viewer.setAttribute('aria-label','Fotografía ampliada');viewer.innerHTML='<button type="button" class="secondary" id="closePhoto">Cerrar ×</button><img id="viewerImage" alt="Fotografía del informe ampliada">';
  document.body.append(overlay,viewer);$('closePhoto').onclick=()=>viewer.close();viewer.addEventListener('close',()=>$('viewerImage').removeAttribute('src'));viewer.onclick=e=>{if(e.target===viewer)viewer.close()};
  $('toast').setAttribute('role','status');$('toast').setAttribute('aria-live','polite');
  new ResizeObserver(scalePreview).observe($('paper'));window.addEventListener('resize',scalePreview);
  showView('editor');updateSectionChecks();document.body.classList.add('mobile-ready');
})();
