// Local employee profiles and report archive. Photos are stored as File/Blob values in IndexedDB.
const EMPLOYEES_KEY = 'mvf-employees-v1';
let employees = [];
try { const saved = JSON.parse(localStorage.getItem(EMPLOYEES_KEY) || '[]'); if (Array.isArray(saved)) employees = saved; } catch {}
if (activeEmployeeId && !employees.some(employee => employee.id === activeEmployeeId)) {
  activeEmployeeId = '';
  localStorage.removeItem('mvf-active-employee');
}
let currentReportId = null;
let openedFromHistory = false;
let editRevision = 0;
let savedRevision = -1;
let draftTimer = null;
let storageErrorShown = false;

const reportDb = new Promise((resolve, reject) => {
  if (!window.indexedDB) { reject(new Error('IndexedDB no disponible')); return; }
  const request = indexedDB.open('mvf-local-reports', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('No se pudo abrir la base local'));
});
function storageProblem(error) {
  console.error(error);
  if (!storageErrorShown) {
    notify('No se pudo guardar el historial. Usa un navegador con almacenamiento local habilitado.');
    storageErrorShown = true;
  }
}
async function dbAction(mode, action) {
  const db = await reportDb;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('records', mode);
    const request = action(transaction.objectStore('records'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Error de almacenamiento'));
    transaction.onabort = () => reject(transaction.error || new Error('Operación cancelada'));
  });
}
const getRecord = id => dbAction('readonly', store => store.get(id));
const putRecord = record => dbAction('readwrite', store => store.put(record));
const deleteRecord = id => dbAction('readwrite', store => store.delete(id));
const getAllRecords = () => dbAction('readonly', store => store.getAll());
function snapshot(id, kind) {
  return {
    id, kind, employeeId: activeEmployeeId, savedAt: new Date().toISOString(),
    reportId: currentReportId, selectedType, photosReduced: true,
    fields: Object.fromEntries(fields.map(field => [field, $(field).value])),
    tasks: tasks.map(task => ({
      description: task.description || '', observation: task.observation || '',
      photos: task.photos.map(photo => photo.file)
    })),
    beforeAfter: {
      before: beforeAfter.before.map(photo => photo.file),
      after: beforeAfter.after.map(photo => photo.file)
    }
  };
}
function releasePhotos() {
  releaseAllThumbnails();previewPhotoSignature=null;
  for (const task of tasks) for (const photo of task.photos || []) if (photo.url) URL.revokeObjectURL(photo.url);
  for (const phase of ['before','after']) for (const photo of beforeAfter[phase]) if(photo.url) URL.revokeObjectURL(photo.url);
}
// Informes antiguos traen fotos en tamaño original: se reducen una por una antes de mostrarlas y se vuelve a guardar el informe ya aligerado.
let openingReport = false;
async function compactRecordPhotos(record) {
  if (record.photosReduced) return false;
  const lists = [...(record.tasks || []).map(task => task.photos || []), record.beforeAfter?.before || [], record.beforeAfter?.after || []];
  const pending = lists.reduce((sum, list) => sum + list.filter(file => file && file.size > PHOTO_KEEP_BYTES && !file.mvfReduced).length, 0);
  if (!pending) { record.photosReduced = true; return false; }
  let done = 0, changed = false;
  for (const list of lists) for (let i = 0; i < list.length; i++) {
    const file = list[i];
    if (!file || file.size <= PHOTO_KEEP_BYTES || file.mvfReduced) continue;
    $('reportStatus').textContent = `Abriendo informe… optimizando fotos ${++done}/${pending}`;
    const smaller = await shrinkPhoto(file);
    if (smaller !== file) { list[i] = smaller; changed = true; }
  }
  record.photosReduced = true;
  if ((record.kind === 'report' || record.kind === 'draft') && record.id) {
    try { await putRecord(record); } catch (error) { console.warn(error); }
  }
  return changed;
}
async function applySnapshotData(record) {
  await compactRecordPhotos(record);
  releasePhotos();
  selectedType = record.selectedType || 'Mantenimiento';
  for (const field of fields) $(field).value = record.fields?.[field] || '';
  if (!$('company').value) $('company').value = '0';
  if (!record.fields?.clientRuc || !record.fields?.clientAddress) fillClientFields();
  tasks = (record.tasks?.length ? record.tasks : [{ description: '', observation: '', photos: [] }]).map(task => ({
    description: task.description || '', observation: task.observation || '',
    photos: (task.photos || []).map(file => ({ file, url: URL.createObjectURL(file) }))
  }));
  beforeAfter = Object.fromEntries(['before','after'].map(phase => [phase,(record.beforeAfter?.[phase] || []).map(file => ({file,url:URL.createObjectURL(file)}))]));
  currentReportId = record.reportId || (record.kind === 'report' ? record.id : null);
  openedFromHistory = record.kind === 'report';
  savedRevision = editRevision;
  document.querySelectorAll('.chip').forEach(chip => chip.classList.toggle('active', chip.dataset.type === selectedType));
  renderTasks(); renderBeforeAfter(); renderPreview(); updateSectionChecks();
  $('reportStatus').textContent = currentReportId ? 'Informe guardado' : 'Borrador local';
}
async function applySnapshot(record){return withBusy('Abriendo informe…',()=>applySnapshotData(record))}
function clearForm() {
  releasePhotos();
  currentReportId = null;
  openedFromHistory = false;
  savedRevision = -1;
  selectedType = 'Mantenimiento';
  for (const field of fields) $(field).value = '';
  $('company').value = '0'; fillClientFields();
  tasks = [{ description: '', observation: '', photos: [] }];
  beforeAfter = { before: [], after: [] };
  document.querySelectorAll('.chip').forEach(chip => chip.classList.toggle('active', chip.dataset.type === selectedType));
  renderTasks(); renderBeforeAfter(); renderPreview(); save();
  $('reportStatus').textContent = 'Borrador local';
}
async function persistDraft() {
  if (!activeEmployeeId) return;
  clearTimeout(draftTimer);
  flushLocalDraft();
  try { await putRecord(snapshot('draft:' + activeEmployeeId, 'draft')); }
  catch (error) { storageProblem(error); }
}
function scheduleDraftSave() {
  if (!activeEmployeeId) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 550);
}
function fillEmployees() {
  const select = $('employeeSelect');
  select.replaceChildren(new Option('Seleccionar empleado', ''));
  for (const employee of employees) select.add(new Option(employee.name, employee.id));
  select.value = activeEmployeeId;
}
async function switchEmployee(nextId) {
  if (nextId === activeEmployeeId) return;
  if (activeEmployeeId) await persistDraft();
  activeEmployeeId = nextId;
  localStorage.setItem('mvf-active-employee', nextId);
  const record = nextId ? await getRecord('draft:' + nextId).catch(error => { storageProblem(error); return null; }) : null;
  if (record) await applySnapshot(record);
  else {
    let oldDraft = null;
    try { oldDraft = JSON.parse(localStorage.getItem('mvf-report-draft-v2:' + nextId) || 'null'); } catch {}
    if (oldDraft) await applySnapshot(oldDraft);
    else clearForm();
  }
  fillEmployees(); renderHistory();
}
function hasReportContent() {
  return ['order','service','place','team','start','end','objective','recommendations'].some(id => $(id).value.trim())
    || tasks.some(task => task.description.trim() || task.observation?.trim() || task.photos.length)
    || beforeAfter.before.length || beforeAfter.after.length;
}
async function saveCurrentReport(quiet = false) {
  if (!activeEmployeeId) { if (!quiet) notify('Selecciona o agrega un empleado antes de guardar.'); return; }
  if (!hasReportContent()) {
    if (!quiet) notify('Agrega al menos un dato del trabajo antes de guardar.');
    return;
  }
  const savedAsAnother = Boolean(currentReportId && !openedFromHistory && editRevision !== savedRevision);
  if (savedAsAnother) currentReportId = null;
  currentReportId ||= crypto.randomUUID();
  const reportId = currentReportId;
  const revision = editRevision;
  const record = snapshot(reportId, 'report');
  try {
    await putRecord(record);
    if (currentReportId === reportId && editRevision === revision) {
      savedRevision = revision;
      $('reportStatus').textContent = 'Informe guardado';
      await persistDraft();
    }
    await renderHistory();
    if (!quiet) notify(savedAsAnother ? 'Guardado como otro informe; el anterior sigue en el historial.' : 'Informe guardado en el historial de este empleado.');
  } catch (error) { storageProblem(error); }
}
function showView(name){
  activeView=name==='history'?'history':name==='preview'?'preview':'editor';
  document.body.dataset.view=activeView;
  $('editorView').hidden=activeView!=='editor';
  $('historyView').hidden=activeView!=='history';
  const preview=$('previewView');if(preview)preview.hidden=activeView!=='preview';
  for(const [id,view] of [['showEditor','editor'],['showPreview','preview'],['showHistory','history']]){const el=$(id);if(el){el.classList.toggle('active',activeView===view);el.setAttribute('aria-selected',String(activeView===view))}}
  if(activeView==='history')renderHistory();
  if(activeView==='preview'){renderPreviewNow();requestAnimationFrame(scalePreview)}
}
async function renderHistory() {
  const list = $('historyList');
  list.replaceChildren();
  if (!activeEmployeeId) { list.textContent = 'Selecciona un empleado para ver sus informes.'; return; }
  let records;
  try { records = await getAllRecords(); }
  catch (error) { storageProblem(error); list.textContent = 'No se pudo abrir el historial local.'; return; }
  const query = $('historySearch').value.trim().toLocaleLowerCase('es');
  const visible = records.filter(record => record.kind === 'report' && record.employeeId === activeEmployeeId)
    .filter(record => [record.fields?.order, record.fields?.service, clients[Number(record.fields?.company)]?.name]
      .some(value => (value || '').toLocaleLowerCase('es').includes(query)))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  if (!visible.length) { list.textContent = query ? 'No hay informes que coincidan con la búsqueda.' : 'Aún no hay informes guardados para este empleado.'; return; }
  for (const record of visible) {
    const row = document.createElement('article'); row.className = 'history-row';
    const content = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = record.fields?.service || record.fields?.order || 'Informe sin título';
    const details = document.createElement('p');
    const client = clients[Number(record.fields?.company)]?.name || 'Empresa sin identificar';
    const date = record.fields?.start ? new Date(record.fields.start).toLocaleDateString('es-PE') : 'Sin fecha de intervención';
    details.textContent = `${client} · ${date} · ${record.fields?.order || 'Sin orden'}`;
    const badge=document.createElement('span');badge.className='history-badge';badge.textContent='Local';content.append(title,details,badge);
    if (window.mvfDriveStatusFor) window.mvfDriveStatusFor(record.id).then(status => { if(status)badge.textContent=status; });
    const open = document.createElement('button'); open.type = 'button'; open.className = 'secondary'; open.textContent = 'Abrir';
    open.onclick = async () => { if (openingReport) return; openingReport = true; open.disabled = true; open.textContent = 'Abriendo…'; try { if (activeEmployeeId) await persistDraft(); await applySnapshot(record); await persistDraft(); } catch (error) { console.error(error); notify('No se pudo abrir el informe.'); } finally { openingReport = false; open.disabled = false; open.textContent = 'Abrir'; } showView('editor'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary danger'; remove.textContent = 'Borrar';
    remove.onclick = async () => {
      const name = record.fields?.service || record.fields?.order || 'este informe';
      if (!confirm(`¿Borrar «${name}» del historial de este celular?

No se puede deshacer. Si ya lo enviaste a Drive o a pendientes, allí sigue.`)) return;
      try {
        await deleteRecord(record.id);
        if (currentReportId === record.id) clearForm();
        notify('Informe borrado del historial.');
        await renderHistory();
      } catch (error) { storageProblem(error); }
    };
    const buttons = document.createElement('div'); buttons.className = 'history-buttons'; buttons.append(open, remove);
    row.append(content, buttons); list.append(row);
  }
}
fillEmployees();
$('employeeSelect').addEventListener('change', event => switchEmployee(event.target.value));
$('addEmployee').onclick = () => {
  const name = prompt('Nombre del empleado');
  if (!name?.trim()) return;
  if (employees.some(employee => employee.name.toLocaleLowerCase('es') === name.trim().toLocaleLowerCase('es'))) {
    notify('Ese empleado ya está en la lista.'); return;
  }
  const id = crypto.randomUUID();
  employees.push({ id, name: name.trim() });
  localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(employees));
  if (!activeEmployeeId) {
    activeEmployeeId = id; localStorage.setItem('mvf-active-employee', id);
    save(); fillEmployees(); renderHistory();
  } else switchEmployee(id);
};
$('showEditor').onclick = () => showView('editor');
$('showHistory').onclick = () => showView('history');
$('historySearch').addEventListener('input', renderHistory);
$('saveReport').onclick = () => saveCurrentReport();
$('newReport').onclick = () => {
  const keeps = activeEmployeeId ? 'Lo que llevas se guardará en tu historial.' : 'No hay empleado seleccionado: lo que llevas se perderá.';
  if (hasReportContent() && !confirm('¿Quieres crear un nuevo informe?\n\n' + keeps)) return;
  if (!hasReportContent() && !confirm('¿Quieres crear un nuevo informe?')) return;
  const shouldSavePrevious = activeEmployeeId && hasReportContent() && (!currentReportId || editRevision !== savedRevision);
  let previous = null;
  if (shouldSavePrevious) {
    const id = currentReportId && openedFromHistory ? currentReportId : crypto.randomUUID();
    previous = snapshot(id, 'report');
    previous.reportId = id;
  }
  clearForm(); showView('editor');
  if (previous) putRecord(previous).then(renderHistory).catch(storageProblem);
};
const exportWord = $('word').onclick;
$('word').onclick = async event => { await exportWord(event); if (activeEmployeeId) await saveCurrentReport(true); };
const exportPdf = $('pdf').onclick;
$('pdf').onclick = event => { exportPdf(event); if (activeEmployeeId) void saveCurrentReport(true); };
if (activeEmployeeId) getRecord('draft:' + activeEmployeeId).then(async record => {
  if (record) await applySnapshot(record);
  renderHistory();
}).catch(storageProblem);
else renderHistory();
