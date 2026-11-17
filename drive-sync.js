// Conexión con el script de Google de MVF:
//  · "Enviar a Drive": sube el Word terminado a la carpeta de MVF.
//  · Historial compartido: cada informe guardado se comparte con el equipo para que otro
//    trabajador pueda abrirlo en su celular y terminarlo.
// Todo pasa por una cola local (IndexedDB) que se reintenta sola cuando vuelve la conexión.
(() => {
  const CONFIG_KEY = 'mvf-drive-config';
  const VERSIONS_KEY = 'mvf-shared-versions';
  const FINISHED_KEY = 'mvf-finished-reports';
  const base = window.MVF_DRIVE_CONFIG || {};
  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  function driveConfig() {
    const saved = readJson(CONFIG_KEY, {});
    return { url: (saved.url || base.url || '').trim(), token: (saved.token || base.token || '').trim() };
  }
  let deviceId = localStorage.getItem('mvf-device-id');
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem('mvf-device-id', deviceId); }
  const sharedVersions = readJson(VERSIONS_KEY, {});
  const finishedReports = readJson(FINISHED_KEY, {});

  // ---------- Cola local ----------
  const queueDb = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB no disponible')); return; }
    const request = indexedDB.open('mvf-drive-queue', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('uploads', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir la cola de envíos'));
  });
  async function queueAction(mode, action) {
    const db = await queueDb;
    return new Promise((resolve, reject) => {
      const request = action(db.transaction('uploads', mode).objectStore('uploads'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Error en la cola de envíos'));
    });
  }
  const allUploads = () => queueAction('readonly', store => store.getAll());
  const putUpload = item => queueAction('readwrite', store => store.put(item));
  const getUpload = id => queueAction('readonly', store => store.get(id));

  // ---------- Llamada al script ----------
  let callCounter = 0;
  const waiting = new Map();
  window.MVFDrive = {
    onScript(callId, text) {
      const done = waiting.get(callId);
      waiting.delete(callId);
      if (!done) return;
      try { done(JSON.parse(text)); } catch { done({ ok: false, error: 'Respuesta inesperada del script.' }); }
    }
  };
  async function scriptCall(body) {
    const config = driveConfig();
    if (!config.url || !config.token) return { ok: false, error: 'Falta configurar Drive (botón Drive).' };
    const payload = JSON.stringify(Object.assign({ token: config.token, device: deviceId }, body));
    if (window.MVFAndroid?.callScript) {
      const callId = 'c' + (++callCounter);
      const limit = body.action === 'upload' || body.action === 'saveDraft' ? 240000 : 90000;
      return new Promise(resolve => {
        const timer = setTimeout(() => { if (waiting.delete(callId)) resolve({ ok: false, error: 'Google tardó demasiado en responder. Toca Actualizar.' }); }, limit);
        waiting.set(callId, result => { clearTimeout(timer); resolve(result); });
        try { window.MVFAndroid.callScript(callId, config.url, payload); }
        catch (error) { clearTimeout(timer); waiting.delete(callId); resolve({ ok: false, error: 'No se pudo conectar: ' + (error.message || error) }); }
      });
    }
    try {
      const response = await fetch(config.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload });
      return await response.json();
    } catch { return { ok: false, error: 'Sin conexión o servidor no disponible.' }; }
  }

  // ---------- Utilidades ----------
  const slug = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toUpperCase().slice(0, 40);
  const blobBase64 = blob => imageData(blob).then(data => data.split(',')[1]);
  function base64Blob(b64, type) {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  const employeeName = () => employees.find(item => item.id === activeEmployeeId)?.name || '';
  const clientName = index => clients[Number(index)]?.name || '';

  function reportMeta() {
    const client = clients[Number($('company').value)] || {};
    const start = $('start').value || '';
    return {
      empresa: client.name || '', ruc: $('clientRuc')?.value || client.ruc || '',
      ordenServicio: $('order').value.trim(), numeroServicio: $('service').value.trim(),
      tipoTrabajo: $('customType').value.trim() || selectedType,
      fechaIntervencion: start ? start.slice(0, 10) : '', lugar: $('place').value.trim(),
      empleado: employeeName(), informeId: currentReportId || '',
      ordenCompra: ''   // la completa después el bot o la oficina
    };
  }
  // Nombre del Word en Drive: EMPRESA - Informe 007 - servicio corto - Empleado.docx
  const SHORT_COMPANY = { '20452614767':'CALERA','20104498044':'TEXTIL DEL VALLE','20102240040':'CHASQUI','20259572887':'ZAPLER',
    '20293847038':'CAMONES','20294866117':'BRANDE','20297939131':'BETA','20380336384':'EXALMAR','20506883301':'CMT DEL SUR',
    '20512868046':'COPEINCA','20522061035':'ROMEX','20554115226':'SHOUTE METAL','20610799869':'VIRU','20613982877':'TAMBO DE MORA' };
  const cleanName = value => String(value || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  function shortCompany(name, ruc) {
    if (SHORT_COMPANY[ruc]) return SHORT_COMPANY[ruc];
    const text = cleanName(name).toUpperCase()
      .replace(/(^|\s)(S\.?\s?A\.?\s?C\.?|S\.?\s?A\.?\s?A\.?|S\.?\s?R\.?\s?L\.?|E\.?\s?I\.?\s?R\.?\s?L\.?|S\.?\s?A\.?|BIC)(?=\s|$)/g, ' ')
      .replace(/[.,]/g, ' ').replace(/^\s*(LA|EL|LOS|LAS)\s+/, '').replace(/\s+/g, ' ').trim();
    return text.split(' ').slice(0, 3).join(' ') || 'SIN EMPRESA';
  }
  function shortWork(service, type) {
    let text = cleanName(service).replace(/^(el\s+|la\s+)?servicios?\s+(de\s+)?/i, '');
    if (!text) return cleanName(type) || 'Trabajo';
    if (text.length > 35) {
      text = text.slice(0, 36).replace(/\s+\S*$/, '');
      text = text.replace(/\s+(y|de|del|la|el|los|las|en|con|para|a|e)$/i, '');
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  const NUMBERS_KEY = 'mvf-report-numbers';
  function reportNumber(reportId, employeeId) {
    const data = readJson(NUMBERS_KEY, {});
    data.byReport = data.byReport || {}; data.counters = data.counters || {};
    if (reportId && data.byReport[reportId]) return data.byReport[reportId];
    const next = (data.counters[employeeId] || 0) + 1;
    data.counters[employeeId] = next;
    if (reportId) data.byReport[reportId] = next;
    writeJson(NUMBERS_KEY, data);
    return next;
  }
  function driveName(meta, ext) {
    const employee = cleanName(meta.empleado);
    const parts = [shortCompany(meta.empresa, meta.ruc), 'Informe ' + String(meta.numeroInforme).padStart(3, '0'),
      shortWork(meta.numeroServicio, meta.tipoTrabajo), employee ? employee.charAt(0).toUpperCase() + employee.slice(1) : 'Sin empleado'];
    return parts.join(' - ') + '.' + ext;
  }
  window.mvfDriveName = { shortCompany, shortWork, driveName };

  // Convierte un informe del historial (con fotos File) a texto JSON y viceversa.
  async function serializeRecord(record) {
    const photo = async file => ({ name: file.name || 'foto.jpg', type: file.type || 'image/jpeg', data: await blobBase64(file) });
    const tasksOut = [];
    for (const task of record.tasks || []) {
      const photos = [];
      for (const file of task.photos || []) photos.push(await photo(file));
      tasksOut.push({ description: task.description || '', observation: task.observation || '', photos });
    }
    const beforeAfterOut = { before: [], after: [] };
    for (const phase of ['before', 'after']) for (const file of record.beforeAfter?.[phase] || []) beforeAfterOut[phase].push(await photo(file));
    return JSON.stringify({ id: record.reportId, selectedType: record.selectedType, fields: record.fields, tasks: tasksOut, beforeAfter: beforeAfterOut });
  }
  function deserializeRecord(text) {
    const data = JSON.parse(text);
    const toFile = p => new File([base64Blob(p.data, p.type)], p.name || 'foto.jpg', { type: p.type || 'image/jpeg' });
    return {
      id: data.id, kind: 'report', reportId: data.id, employeeId: activeEmployeeId, savedAt: new Date().toISOString(),
      selectedType: data.selectedType, fields: data.fields || {},
      tasks: (data.tasks || []).map(task => ({ description: task.description, observation: task.observation, photos: (task.photos || []).map(toFile) })),
      beforeAfter: { before: (data.beforeAfter?.before || []).map(toFile), after: (data.beforeAfter?.after || []).map(toFile) }
    };
  }

  // ---------- Encolar ----------
  // Se llama desde el historial cada vez que se guarda un informe.
  window.mvfShareReport = async record => {
    const reportId = record?.reportId || record?.id;
    if (!reportId || !driveConfig().url) return;
    if (finishedReports[reportId]) return;   // ya enviado como Word: no se vuelve a abrir para el equipo
    const fields = record.fields || {};
    const item = {
      id: 'draft:' + reportId, kind: 'draft', reportId, record, status: 'pending', createdAt: new Date().toISOString(),
      meta: {
        titulo: fields.service || fields.order || 'Informe sin título', empresa: clientName(fields.company),
        ordenServicio: fields.order || '', numeroServicio: fields.service || '', fechaIntervencion: (fields.start || '').slice(0, 10),
        guardadoPor: employeeName()
      }
    };
    try { await putUpload(item); } catch (error) { console.error(error); return; }
    refreshStatus(); processQueue();
  };

  async function sendToTeam() {
    if (!activeEmployeeId) { notify('Selecciona o agrega un empleado antes de enviar.'); return; }
    if (!hasReportContent()) { notify('El informe está vacío.'); return; }
    await saveCurrentReport(true);
    const record = await getRecord(currentReportId).catch(() => null);
    if (!record) { notify('No se pudo preparar el informe.'); return; }
    delete finishedReports[record.reportId || record.id];
    writeJson(FINISHED_KEY, finishedReports);
    await window.mvfShareReport(record);
    notify(navigator.onLine ? 'Enviando a pendientes del equipo…' : 'Sin internet: se enviará a pendientes cuando vuelva la señal.');
  }

  async function sendCurrentToDrive() {
    if (!activeEmployeeId) { notify('Selecciona o agrega un empleado antes de enviar.'); return; }
    if (!hasReportContent()) { notify('El informe está vacío.'); return; }
    await saveCurrentReport(true);
    let file;
    try { file = await buildWordFile(); }
    catch (error) { console.error(error); notify(error.message || 'No se pudo generar el Word.'); return; }
    const id = crypto.randomUUID();
    const meta = reportMeta();
    meta.numeroInforme = reportNumber(currentReportId, activeEmployeeId);
    const item = { id, kind: 'word', reportId: currentReportId, employeeId: activeEmployeeId, name: driveName(meta, file.name.split('.').pop()),
      mime: file.mime, blob: file.blob, meta, status: 'pending', createdAt: new Date().toISOString() };
    try { await putUpload(item); }
    catch (error) { console.error(error); notify('No se pudo guardar en la cola de envío.'); return; }
    notify(navigator.onLine ? 'Enviando a Drive…' : 'Sin internet: quedó pendiente y se enviará cuando haya señal.');
    await refreshStatus();
    processQueue();
  }

  // ---------- Enviar la cola ----------
  async function sendItem(item) {
    if (item.kind === 'draft') {
      const content = await serializeRecord(item.record);
      const result = await scriptCall({ action: 'saveDraft', draft: { id: item.reportId, baseVersion: sharedVersions[item.reportId] || 0, meta: item.meta, content } });
      if (!result.ok) return result;
      if (result.conflict) {
        // Otro compañero guardó antes: esta versión quedó en el equipo como copia con otro id.
        sharedVersions[result.copyId] = result.version;
        if (currentReportId === item.reportId) currentReportId = result.copyId;
        const copy = Object.assign({}, item.record, { id: result.copyId, reportId: result.copyId });
        await putRecord(copy).catch(console.error);
        notify(`${result.otro || 'Otro compañero'} guardó este informe antes. Tu versión se guardó como copia.`);
      } else sharedVersions[item.reportId] = result.version;
      writeJson(VERSIONS_KEY, sharedVersions);
      return { ok: true };
    }
    const result = await scriptCall({ action: 'upload', uploadId: item.id, name: item.name, mime: item.mime, meta: item.meta, content: await blobBase64(item.blob) });
    if (result.ok && item.reportId) { finishedReports[item.reportId] = true; writeJson(FINISHED_KEY, finishedReports); }
    return { ok: !!result.ok, error: result.error, fileUrl: result.url };
  }

  let sending = false;
  async function processQueue(manual = false) {
    if (sending) return;
    const config = driveConfig();
    if (!config.url || !config.token) { if (manual) notify('Falta configurar Drive (botón Drive).'); await refreshStatus(); return; }
    let items;
    try { items = (await allUploads()).filter(item => item.status !== 'sent').sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
    catch (error) { console.error(error); return; }
    if (!items.length) { if (manual) notify('No hay nada pendiente de envío.'); await refreshStatus(); return; }
    if (!navigator.onLine) { if (manual) notify('Sin internet. Queda pendiente y se enviará solo.'); await refreshStatus(); return; }
    sending = true; await refreshStatus();
    let words = 0, drafts = 0, failed = 0, lastError = '';
    for (const queued of items) {
      // Releer por si se reemplazó mientras se enviaba otro (p. ej. el trabajador volvió a guardar).
      const item = await getUpload(queued.id).catch(() => queued);
      if (!item || item.status === 'sent') continue;
      const result = await sendItem(item);
      const latest = await getUpload(item.id).catch(() => item);
      if (latest && latest.createdAt !== item.createdAt) continue;   // hay una versión más nueva en la cola
      if (result.ok) {
        Object.assign(item, { status: 'sent', sentAt: new Date().toISOString(), fileUrl: result.fileUrl || '', error: '' });
        item.blob = null; item.record = null;
        if (item.kind === 'word') words++;
        if (item.kind === 'draft') drafts++;
      } else {
        Object.assign(item, { status: 'error', error: result.error || 'Error desconocido', tries: (item.tries || 0) + 1 });
        failed++; lastError = item.error;
      }
      await putUpload(item).catch(console.error);
      if (!result.ok && /clave|token|autoriz|publicado|direcci/i.test(result.error || '')) break;
    }
    sending = false; await refreshStatus();
    if (words || drafts) notify([words ? `${words} informe(s) enviados a Drive.` : '', drafts ? `${drafts} informe(s) enviados a pendientes del equipo.` : ''].filter(Boolean).join(' '));
    else if (failed && manual) notify('No se pudo enviar: ' + lastError);
    if (drafts > 0 && !$('historyView').hidden) renderTeam();
    if (typeof renderHistory === 'function') renderHistory();
  }

  async function refreshStatus() {
    const box = $('driveStatus');
    if (!box) return;
    let pending = 0;
    try { pending = (await allUploads()).filter(item => item.status !== 'sent').length; } catch {}
    box.classList.toggle('pending', pending > 0);
    if (!driveConfig().url || !driveConfig().token) box.textContent = 'Drive sin configurar';
    else if (sending) box.textContent = 'Enviando…';
    else if (pending) box.textContent = `${pending} ${pending===1?'pendiente':'pendientes'}`;
    else box.textContent = 'Drive al día ✓';
  }

  // Estado de cada informe para el historial local.
  window.mvfDriveStatusFor = async reportId => {
    try {
      const items = (await allUploads()).filter(item => item.reportId === reportId);
      const words = items.filter(item => item.kind !== 'draft');
      if (words.some(item => item.status === 'sent')) return 'Enviado a Drive ✓';
      if (words.length) return 'Pendiente de envío';
      const draft = items.find(item => item.kind === 'draft');
      if (draft) return draft.status === 'sent' ? 'En pendientes del equipo' : 'Enviando a pendientes…';
      return '';
    } catch { return ''; }
  };

  // ---------- Informes del equipo ----------
  let teamLoading = null;
  async function renderTeam() {
    const list = $('teamList');
    if (!list) return;
    if (!driveConfig().url) { list.textContent = 'Configura Drive para ver los informes del equipo.'; return; }
    if (teamLoading) return teamLoading;
    list.textContent = 'Cargando informes del equipo…';
    teamLoading = scriptCall({ action: 'listDrafts' });
    let result;
    try { result = await teamLoading; } finally { teamLoading = null; }
    if (!result || !result.ok) { list.textContent = (navigator.onLine ? 'No se pudo cargar: ' : 'Sin internet: ') + ((result && result.error) || 'error') + ' Toca Actualizar para reintentar.'; return; }
    const query = $('historySearch').value.trim().toLocaleLowerCase('es');
    const drafts = (result.drafts || []).filter(d => [d.titulo, d.empresa, d.ordenServicio, d.numeroServicio, d.guardadoPor]
      .some(value => String(value || '').toLocaleLowerCase('es').includes(query)));
    list.replaceChildren();
    if (!drafts.length) { list.textContent = query ? 'Ningún informe del equipo coincide con la búsqueda.' : 'No hay informes pendientes del equipo.'; return; }
    for (const draft of drafts) {
      const row = document.createElement('article'); row.className = 'history-row';
      const content = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = draft.titulo || 'Informe sin título';
      const details = document.createElement('p');
      const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '';
      details.textContent = `${draft.empresa || 'Empresa sin identificar'} · ${draft.ordenServicio || 'Sin orden'} · Guardado por ${draft.guardadoPor || '¿?'} ${when ? '· ' + when : ''}`;
      if (draft.id === currentReportId) details.textContent += ' · abierto ahora';
      content.append(title, details);
      const open = document.createElement('button'); open.type = 'button'; open.className = 'secondary'; open.textContent = 'Abrir';
      open.onclick = () => openTeamDraft(draft, open);
      row.append(content, open); list.append(row);
    }
  }

  async function openTeamDraft(draft, button) {
    if (!activeEmployeeId) { notify('Selecciona tu nombre de empleado antes de abrir un informe.'); return; }
    button.disabled = true; button.textContent = 'Descargando…';
    const result = await scriptCall({ action: 'getDraft', id: draft.id });
    button.disabled = false; button.textContent = 'Abrir';
    if (!result.ok) { notify(result.error || 'No se pudo descargar el informe.'); return; }
    let record;
    try { record = deserializeRecord(result.content); }
    catch (error) { console.error(error); notify('El informe descargado está dañado.'); return; }
    await persistDraft();
    try { await putRecord(record); } catch (error) { storageProblem(error); }
    sharedVersions[record.reportId] = result.meta?.version || 0;
    writeJson(VERSIONS_KEY, sharedVersions);
    await applySnapshot(record);
    await persistDraft();
    showView('editor');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    notify(`Informe de ${result.meta?.guardadoPor || 'un compañero'} abierto. Continúa y pulsa Guardar en historial.`);
  }

  $('driveSend').onclick = sendCurrentToDrive;
  $('teamSend').onclick = sendToTeam;
  $('driveStatus').onclick = () => {
    if (!driveConfig().token) {
      const entered = (window.prompt('Escribe el token de Drive (la clave que te dio MVF)') || '').trim();
      if (!entered) return;
      writeJson(CONFIG_KEY, Object.assign(readJson(CONFIG_KEY, {}), { token: entered }));
      notify('Token guardado.');
    }
    processQueue(true);
  };
  $('teamRefresh').onclick = () => renderTeam();
  $('showHistory').addEventListener('click', () => renderTeam());
  $('historySearch').addEventListener('input', () => { clearTimeout(window.__mvfTeamSearch); window.__mvfTeamSearch = setTimeout(renderTeam, 500); });
  window.addEventListener('online', () => processQueue());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) processQueue(); });
  setInterval(() => processQueue(), 90000);
  refreshStatus();
  setTimeout(() => processQueue(), 1500);
})();
