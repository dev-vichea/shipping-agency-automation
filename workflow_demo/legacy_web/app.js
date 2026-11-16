/**
 * Shipping Agency AI Automation — Guided Workflow Demo Client
 * Plain Vanilla JavaScript connecting to FastAPI backend (/api/v1)
 */

(function () {
  'use strict';

  // Application State
  const state = {
    user: null,
    caseId: null,
    caseDetail: null,
    analysis: null,
    reviewData: null,
    latestReview: null,
    importRecord: null,
    permitDrafts: [],
    cdcVersions: [],
    stagedFiles: [],
    currentStep: 1,
    pollInterval: null,
    findingsFilter: 'ALL',
  };

  // DOM Elements
  const el = {
    // Header & Context
    caseSelect: document.getElementById('caseSelect'),
    refreshBtn: document.getElementById('refreshBtn'),
    staffStatus: document.getElementById('staffStatus'),
    loginModalBtn: document.getElementById('loginModalBtn'),
    caseContextBar: document.getElementById('caseContextBar'),
    ctxCaseId: document.getElementById('ctxCaseId'),
    ctxRef: document.getElementById('ctxRef'),
    ctxRev: document.getElementById('ctxRev'),
    ctxState: document.getElementById('ctxState'),
    ctxOutcome: document.getElementById('ctxOutcome'),
    ctxAi: document.getElementById('ctxAi'),
    errorBanner: document.getElementById('errorBanner'),
    errorTitle: document.getElementById('errorTitle'),
    errorMsg: document.getElementById('errorMsg'),
    errorCloseBtn: document.getElementById('errorCloseBtn'),
    wizardSteps: document.querySelectorAll('.wizard-step'),
    stepPanels: document.querySelectorAll('.step-panel'),

    // Step 1: Inbound Intake
    intakeForm: document.getElementById('intakeForm'),
    intakeTargetBox: document.getElementById('intakeTargetBox'),
    modeNew: document.getElementById('modeNew'),
    modeExisting: document.getElementById('modeExisting'),
    activeCasePill: document.getElementById('activeCasePill'),
    intakeSubject: document.getElementById('intakeSubject'),
    intakeSender: document.getElementById('intakeSender'),
    intakeBody: document.getElementById('intakeBody'),
    dropzoneArea: document.getElementById('dropzoneArea'),
    intakeFiles: document.getElementById('intakeFiles'),
    stagedFilesContainer: document.getElementById('stagedFilesContainer'),
    stagedCountBadge: document.getElementById('stagedCountBadge'),
    fileListPreview: document.getElementById('fileListPreview'),
    clearFilesBtn: document.getElementById('clearFilesBtn'),
    btnLoadScan: document.getElementById('btnLoadScan'),
    btnLoadMismatch: document.getElementById('btnLoadMismatch'),
    intakeProviderId: document.getElementById('intakeProviderId'),
    genIdBtn: document.getElementById('genIdBtn'),
    submitIntakeBtn: document.getElementById('submitIntakeBtn'),
    receiptBox: document.getElementById('receiptBox'),
    receiptJson: document.getElementById('receiptJson'),

    // Step 2: Processing & Workers
    step2StatusPill: document.getElementById('step2StatusPill'),
    stageReceipt: document.getElementById('stageReceipt'),
    analysisStageStatus: document.getElementById('analysisStageStatus'),
    aiStageStatus: document.getElementById('aiStageStatus'),
    investigationBox: document.getElementById('investigationBox'),
    investigationSummary: document.getElementById('investigationSummary'),
    investigationSteps: document.getElementById('investigationSteps'),
    reprocessBtn: document.getElementById('reprocessBtn'),
    runsTableBody: document.getElementById('runsTableBody'),
    btnToStep3: document.getElementById('btnToStep3'),

    // Step 3: Document Validation
    step3OutcomePill: document.getElementById('step3OutcomePill'),
    documentsSummaryGrid: document.getElementById('documentsSummaryGrid'),
    aiAdvisoryBox: document.getElementById('aiAdvisoryBox'),
    aiModelName: document.getElementById('aiModelName'),
    aiSuggestionsList: document.getElementById('aiSuggestionsList'),
    invoiceItemsTableBody: document.getElementById('invoiceItemsTableBody'),
    findingsCount: document.getElementById('findingsCount'),
    findingsTableBody: document.getElementById('findingsTableBody'),
    filterTabs: document.querySelectorAll('.filter-tab'),

    // Step 4: CDC Reconciliation
    selectedMasterPill: document.getElementById('selectedMasterPill'),
    cdcVersionSelect: document.getElementById('cdcVersionSelect'),
    applyCdcBtn: document.getElementById('applyCdcBtn'),
    toggleUploadMasterBtn: document.getElementById('toggleUploadMasterBtn'),
    companyCheckNotice: document.getElementById('companyCheckNotice'),
    registerMasterBox: document.getElementById('registerMasterBox'),
    registerMasterForm: document.getElementById('registerMasterForm'),
    candidateCount: document.getElementById('candidateCount'),
    candidatesTableBody: document.getElementById('candidatesTableBody'),

    // Step 5: Staff Review
    reviewReadyPill: document.getElementById('reviewReadyPill'),
    blockersBox: document.getElementById('blockersBox'),
    blockersCount: document.getElementById('blockersCount'),
    blockersList: document.getElementById('blockersList'),
    readyBox: document.getElementById('readyBox'),
    staffReviewForm: document.getElementById('staffReviewForm'),
    mappingRowsTableBody: document.getElementById('mappingRowsTableBody'),
    verifyCdcCheckbox: document.getElementById('verifyCdcCheckbox'),
    resolutionsContainer: document.getElementById('resolutionsContainer'),
    infoFindingsBox: document.getElementById('infoFindingsBox'),
    infoFindingsList: document.getElementById('infoFindingsList'),
    saveReviewBtn: document.getElementById('saveReviewBtn'),
    btnToStep6: document.getElementById('btnToStep6'),

    // Step 6: Approval
    step6StatePill: document.getElementById('step6StatePill'),
    alreadyApprovedNotice: document.getElementById('alreadyApprovedNotice'),
    goToStep7FromApprovedBtn: document.getElementById('goToStep7FromApprovedBtn'),
    approvalGateWarning: document.getElementById('approvalGateWarning'),
    snapRev: document.getElementById('snapRev'),
    snapHash: document.getElementById('snapHash'),
    snapPermitPending: document.getElementById('snapPermitPending'),
    approvalForm: document.getElementById('approvalForm'),
    approvalNotes: document.getElementById('approvalNotes'),
    rejectBtn: document.getElementById('rejectBtn'),
    approveBtn: document.getElementById('approveBtn'),

    // Step 7: Generated Results
    importOverviewGrid: document.getElementById('importOverviewGrid'),
    approvedItemsCount: document.getElementById('approvedItemsCount'),
    approvedItemsTableBody: document.getElementById('approvedItemsTableBody'),
    permitDraftsTableBody: document.getElementById('permitDraftsTableBody'),
    brokerReleaseBox: document.getElementById('brokerReleaseBox'),
    brokerReleaseForm: document.getElementById('brokerReleaseForm'),
    brokerEmail: document.getElementById('brokerEmail'),
    releaseNotes: document.getElementById('releaseNotes'),
    authReleaseBtn: document.getElementById('authReleaseBtn'),
    releaseSuccessMsg: document.getElementById('releaseSuccessMsg'),
    startNewIntakeBtn: document.getElementById('startNewIntakeBtn'),

    // Login Modal
    loginModal: document.getElementById('loginModal'),
    closeLoginModal: document.getElementById('closeLoginModal'),
    loginForm: document.getElementById('loginForm'),
    loginEmail: document.getElementById('loginEmail'),
    loginPassword: document.getElementById('loginPassword'),
    loginError: document.getElementById('loginError'),
  };

  // Base API caller with credentials and origin header
  async function api(path, options = {}) {
    hideError();
    const opts = { ...options };
    opts.credentials = 'same-origin';
    opts.headers = opts.headers ? { ...opts.headers } : {};

    // If body is plain object, encode as JSON
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    try {
      const res = await fetch(path, opts);
      if (res.status === 204) {
        return null;
      }
      if (!res.ok) {
        let errDetail = `${res.status} ${res.statusText}`;
        try {
          const errJson = await res.json();
          if (errJson && errJson.detail) {
            errDetail = typeof errJson.detail === 'string' ? errJson.detail : JSON.stringify(errJson.detail);
          }
        } catch {
          // not json
        }
        const error = new Error(errDetail);
        error.status = res.status;
        throw error;
      }

      // Check content-type
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await res.json();
      }
      return res;
    } catch (err) {
      if (err.status !== 401 && err.status !== 404) {
        showError('API Request Failed', `${path}: ${err.message}`);
      }
      throw err;
    }
  }

  // Error Banner UI
  function showError(title, msg) {
    el.errorTitle.textContent = title;
    el.errorMsg.textContent = msg;
    el.errorBanner.classList.remove('hidden');
  }

  function hideError() {
    el.errorBanner.classList.add('hidden');
  }

  el.errorCloseBtn.addEventListener('click', hideError);

  // Authentication
  async function checkAuth() {
    try {
      const me = await api('/api/v1/auth/me');
      state.user = me;
      el.staffStatus.textContent = me.email || 'Staff Member';
      el.staffStatus.classList.add('logged-in');
      el.loginModalBtn.textContent = 'Sign Out';
      return true;
    } catch (err) {
      if (err.status !== 401) console.warn('Session check failed');
      state.user = null;
      el.staffStatus.textContent = 'Not Signed In';
      el.staffStatus.classList.remove('logged-in');
      el.loginModalBtn.textContent = 'Sign In';
      return false;
    }
  }

  el.loginModalBtn.addEventListener('click', () => {
    if (state.user) {
      api('/api/v1/auth/logout', { method: 'POST' }).then(() => {
        checkAuth().then(() => loadCases());
      });
    } else {
      el.loginError.classList.add('hidden');
      el.loginModal.showModal();
    }
  });

  el.closeLoginModal.addEventListener('click', () => el.loginModal.close());

  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.loginError.classList.add('hidden');
    try {
      await api('/api/v1/auth/login', {
        method: 'POST',
        body: {
          email: el.loginEmail.value.trim(),
          password: el.loginPassword.value,
        },
      });
      el.loginModal.close();
      await checkAuth();
      await loadCases();
    } catch (err) {
      el.loginError.textContent = err.message || 'Authentication failed';
      el.loginError.classList.remove('hidden');
    }
  });

  // Step Navigation
  function goToStep(stepNum) {
    state.currentStep = stepNum;

    // Update wizard tabs
    el.wizardSteps.forEach((btn) => {
      const s = parseInt(btn.dataset.step, 10);
      btn.classList.toggle('active', s === stepNum);
    });

    // Update step panel visibility
    el.stepPanels.forEach((panel) => {
      panel.classList.add('hidden');
    });
    const activePanel = document.getElementById(`step${stepNum}View`);
    if (activePanel) {
      activePanel.classList.remove('hidden');
    }

    // Refresh step data
    if (state.caseId) {
      if (stepNum === 2) {
        refreshRuns();
      } else if (stepNum === 3) {
        renderValidationStep();
      } else if (stepNum === 4) {
        renderCdcStep();
      } else if (stepNum === 5) {
        renderReviewStep();
      } else if (stepNum === 6) {
        renderApprovalStep();
      } else if (stepNum === 7) {
        renderResultsStep();
      }
    }
  }

  // Bind wizard button clicks
  el.wizardSteps.forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = parseInt(btn.dataset.step, 10);
      goToStep(step);
    });
  });

  // Global delegate for data-nav-step buttons
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-nav-step]');
    if (target) {
      const step = parseInt(target.dataset.navStep, 10);
      goToStep(step);
    }
  });

  // Case Selection & Context Bar
  async function loadCases(selectedId = null) {
    try {
      const list = await api('/api/v1/intakes?limit=40');
      el.caseSelect.innerHTML = '<option value="">+ New Intake (Start at Step 1)</option>';
      if (Array.isArray(list)) {
        list.forEach((item) => {
          const opt = document.createElement('option');
          opt.value = item.id;
          const ref = item.detected_reference ? `[${item.detected_reference}] ` : '';
          const subject = item.subject ? item.subject.slice(0, 36) : 'Intake Case';
          opt.textContent = `${ref}${subject} (${item.state})`;
          el.caseSelect.appendChild(opt);
        });
      }

      if (selectedId) {
        el.caseSelect.value = selectedId;
        await selectCase(selectedId);
      } else if (state.caseId) {
        el.caseSelect.value = state.caseId;
      }
    } catch (err) {
      console.warn('Failed to load intakes list:', err);
    }
  }

  el.caseSelect.addEventListener('change', async () => {
    const val = el.caseSelect.value;
    if (!val) {
      resetCase();
      goToStep(1);
    } else {
      await selectCase(val);
    }
  });

  el.refreshBtn.addEventListener('click', async () => {
    if (state.caseId) {
      await selectCase(state.caseId);
    } else {
      await loadCases();
    }
  });

  function resetCase() {
    state.caseId = null;
    state.caseDetail = null;
    state.analysis = null;
    state.reviewData = null;
    state.latestReview = null;
    state.importRecord = null;
    state.permitDrafts = [];
    stopPolling();
    el.caseContextBar.classList.add('hidden');
    el.ctxCaseId.textContent = '—';
    el.ctxRef.textContent = '—';
    el.ctxRev.textContent = '0';
    el.receiptBox.classList.add('hidden');

    // Reset Intake Destination selector
    if (el.intakeTargetBox) {
      el.intakeTargetBox.classList.add('hidden');
      if (el.modeNew) el.modeNew.checked = true;
    }
    updateIntakeTargetUI();
  }

  async function selectCase(caseId) {
    state.caseId = caseId;
    el.caseContextBar.classList.remove('hidden');
    el.ctxCaseId.textContent = caseId.slice(0, 8);

    // Show intake target options when case is active
    if (el.intakeTargetBox) {
      el.intakeTargetBox.classList.remove('hidden');
      el.activeCasePill.textContent = `${caseId.slice(0, 8)}`;
    }

    try {
      const detail = await api(`/api/v1/intakes/${caseId}`);
      if (state.caseId !== caseId) return;
      state.caseDetail = detail;
      updateCaseOption(detail);
      updateStatusPill(el.step2StatusPill, detail.state);
      el.ctxRef.textContent = detail.detected_reference || 'Pending';
      if (el.activeCasePill && detail.detected_reference) {
        el.activeCasePill.textContent = `${caseId.slice(0, 8)} [${detail.detected_reference}]`;
      }
      updateStatusPill(el.ctxState, detail.state);
      updateIntakeTargetUI();

      // Load analysis
      await loadAnalysis();

      // The intake can enter staff review while AI jobs are still finishing.
      const runsPending = await refreshRuns();
      if (state.caseId !== caseId) return;
      if (hasPendingProcessing(detail) || runsPending) startPolling();
      if (detail.state === 'queued' || detail.state === 'processing') {
        goToStep(2);
      } else if (detail.state === 'approved') {
        goToStep(7);
      }
    } catch (err) {
      console.error('Failed to load case detail:', err);
    }
  }

  async function loadAnalysis({ refreshReview = true } = {}) {
    const caseId = state.caseId;
    if (!caseId) return;
    try {
      const res = await api(`/api/v1/intakes/${caseId}/analysis`);
      if (state.caseId !== caseId) return;
      const previous = state.analysis;
      state.analysis = res;
      el.ctxRev.textContent = res.revision;
      if (res.outcome) {
        el.ctxOutcome.textContent = res.outcome;
        el.ctxOutcome.className = `outcome-pill outcome-${res.outcome.toLowerCase()}`;
      } else {
        el.ctxOutcome.textContent = '—';
        el.ctxOutcome.className = 'outcome-pill';
      }

      if (res.ai_state) {
        el.ctxAi.textContent = `AI: ${res.ai_state}`;
        el.ctxAi.className = `ai-pill status-${res.ai_state.toLowerCase()}`;
      } else {
        el.ctxAi.textContent = '—';
        el.ctxAi.className = 'ai-pill';
      }

      // Check if analysis is available
      if (res.state === 'available') {
        el.btnToStep3.disabled = false;
        el.analysisStageStatus.textContent = 'Succeeded';
        el.analysisStageStatus.className = 'stage-status status-succeeded';
      } else {
        el.btnToStep3.disabled = true;
        el.analysisStageStatus.textContent = res.state || 'Pending';
        el.analysisStageStatus.className = `stage-status status-${res.state || 'queued'}`;
      }

      if (res.ai_state === 'ready') {
        el.aiStageStatus.textContent = 'Ready';
        el.aiStageStatus.className = 'stage-status status-succeeded';
      } else {
        el.aiStageStatus.textContent = res.ai_state || 'Pending';
        el.aiStageStatus.className = `stage-status status-${res.ai_state || 'queued'}`;
      }

      // Advisory polling should preserve unsaved staff inputs.
      if (state.currentStep === 3) renderValidationStep();
      if (refreshReview || previous?.revision !== res.revision || previous?.state !== res.state) {
        if (state.currentStep === 4) renderCdcStep();
        if (state.currentStep === 5) renderReviewStep();
        if (state.currentStep === 6) renderApprovalStep();
        if (state.currentStep === 7) renderResultsStep();
      }
    } catch (err) {
      console.warn('Analysis not ready or failed:', err);
    }
  }

  function startPolling() {
    stopPolling();
    const caseId = state.caseId;
    let polling = false;
    const interval = setInterval(async () => {
      if (state.caseId !== caseId) return clearInterval(interval);
      if (polling) return;
      polling = true;
      try {
        const detail = await api(`/api/v1/intakes/${caseId}`);
        if (state.pollInterval !== interval || state.caseId !== caseId) return;
        state.caseDetail = detail;
        updateCaseOption(detail);
        updateStatusPill(el.ctxState, detail.state);
        updateStatusPill(el.step2StatusPill, detail.state);
        await loadAnalysis({ refreshReview: false });
        if (state.pollInterval !== interval || state.caseId !== caseId) return;
        const runsPending = await refreshRuns();

        if (state.pollInterval === interval && state.caseId === caseId
          && !hasPendingProcessing(detail) && !runsPending) {
          stopPolling();
        }
      } catch (err) {
        console.error('Polling error:', err);
      } finally {
        polling = false;
      }
    }, 2500);
    state.pollInterval = interval;
  }

  function hasPendingProcessing(detail) {
    return detail.state === 'queued' || detail.state === 'processing'
      || state.analysis?.state === 'pending' || state.analysis?.ai_state === 'pending';
  }

  function stopPolling() {
    if (state.pollInterval) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
    }
  }

  function updateStatusPill(pillElem, status) {
    if (!pillElem) return;
    pillElem.textContent = status;
    pillElem.className = `status-pill status-${status}`;
  }

  function updateCaseOption(detail) {
    const option = [...el.caseSelect.options].find((item) => item.value === detail.id);
    if (!option) return;
    const ref = detail.detected_reference ? `[${detail.detected_reference}] ` : '';
    const subject = detail.subject ? detail.subject.slice(0, 36) : 'Intake Case';
    option.textContent = `${ref}${subject} (${detail.state})`;
  }

  // STEP 1: MULTI-FILE INTAKE STAGING & DRAG-AND-DROP
  el.genIdBtn.addEventListener('click', () => {
    el.intakeProviderId.value = `msg-sim-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  });

  function updateIntakeTargetUI() {
    if (state.caseId && el.modeExisting && el.modeExisting.checked) {
      el.submitIntakeBtn.textContent = 'Upload & Add to Intake Case →';
    } else {
      el.submitIntakeBtn.textContent = 'Archive Arrival & Start Intake →';
    }
  }

  if (el.modeNew) el.modeNew.addEventListener('change', updateIntakeTargetUI);
  if (el.modeExisting) el.modeExisting.addEventListener('change', updateIntakeTargetUI);

  function addFilesToStaging(fileList) {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);

    for (const file of incoming) {
      if (state.stagedFiles.length >= 5) {
        showError('Attachment Limit', 'Maximum of 5 shipping documents allowed per intake arrival.');
        break;
      }
      const exists = state.stagedFiles.some((f) => f.name === file.name && f.size === file.size);
      if (!exists) {
        state.stagedFiles.push(file);
      }
    }

    renderStagedFiles();
    el.intakeFiles.value = ''; // Reset so the user can immediately pick another file
  }

  function removeStagedFile(index) {
    if (index >= 0 && index < state.stagedFiles.length) {
      state.stagedFiles.splice(index, 1);
      renderStagedFiles();
    }
  }

  function clearStagedFiles() {
    state.stagedFiles = [];
    renderStagedFiles();
  }

  function renderStagedFiles() {
    el.fileListPreview.innerHTML = '';
    const count = state.stagedFiles.length;

    if (count === 0) {
      el.stagedFilesContainer.classList.add('hidden');
      el.stagedCountBadge.textContent = '0 / 5 files';
      return;
    }

    el.stagedFilesContainer.classList.remove('hidden');
    el.stagedCountBadge.textContent = `${count} / 5 files`;

    state.stagedFiles.forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'file-preview-item';
      const sizeKb = (file.size / 1024).toFixed(1);
      const isExcel = file.name.endsWith('.xls') || file.name.endsWith('.xlsx');
      const isPdf = file.name.endsWith('.pdf');
      const icon = isExcel ? '📊' : isPdf ? '📕' : '📄';
      const typeLabel = isExcel ? 'Excel Spreadsheet' : isPdf ? 'PDF Document' : file.type || 'Document';

      item.innerHTML = `
        <div class="file-preview-main">
          <span class="file-preview-icon">${icon}</span>
          <div class="file-preview-details">
            <strong>${escapeHtml(file.name)}</strong>
            <span class="file-preview-meta">${sizeKb} KB · ${escapeHtml(typeLabel)}</span>
          </div>
        </div>
        <div class="file-preview-actions">
          <button type="button" class="file-remove-btn" data-index="${idx}" title="Remove this file">&times;</button>
        </div>
      `;
      el.fileListPreview.appendChild(item);
    });

    // Bind remove buttons
    el.fileListPreview.querySelectorAll('.file-remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index, 10);
        removeStagedFile(index);
      });
    });
  }

  if (el.clearFilesBtn) {
    el.clearFilesBtn.addEventListener('click', clearStagedFiles);
  }

  async function loadPreset(presetId) {
    try {
      const res = await fetch('/api/demo-presets');
      if (!res.ok) throw new Error('Could not fetch demo presets');
      const presets = await res.json();
      const preset = presets.find((p) => p.id === presetId);
      if (!preset || preset.files.length !== 2) {
        throw new Error('Generate the synthetic fixtures using the command in the demo README.');
      }

      el.intakeSubject.value = preset.subject;
      el.intakeBody.value = preset.notes;
      el.intakeProviderId.value = `msg-sim-${preset.id}-${Date.now()}`;

      state.stagedFiles = [];
      for (const f of preset.files) {
        const fileUrl = `/api/demo-presets/file?preset=${preset.id}&filename=${encodeURIComponent(f.name)}`;
        const resp = await fetch(fileUrl);
        if (!resp.ok) throw new Error('Could not read the synthetic fixture.');
        const blob = await resp.blob();
        const fileObj = new File([blob], f.name, { type: blob.type });
        state.stagedFiles.push(fileObj);
      }
      renderStagedFiles();
    } catch (err) {
      console.error('Failed to load preset:', err);
      showError('Failed to load preset', err.message);
    }
  }

  if (el.btnLoadScan) {
    el.btnLoadScan.addEventListener('click', () => loadPreset('scan'));
  }
  if (el.btnLoadMismatch) {
    el.btnLoadMismatch.addEventListener('click', () => loadPreset('mismatch'));
  }

  el.intakeFiles.addEventListener('change', () => {
    addFilesToStaging(el.intakeFiles.files);
  });

  // Drag and drop listeners on dropzone
  if (el.dropzoneArea) {
    el.dropzoneArea.addEventListener('click', (e) => {
      // If clicking directly on dropzone, trigger file input
      if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'LABEL' && e.target.tagName !== 'INPUT') {
        el.intakeFiles.click();
      }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      el.dropzoneArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.dropzoneArea.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      el.dropzoneArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.dropzoneArea.classList.remove('dragover');
      });
    });

    el.dropzoneArea.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files) {
        addFilesToStaging(e.dataTransfer.files);
      }
    });
  }

  el.intakeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.stagedFiles.length === 0) {
      showError('Validation Error', 'Please choose or drag & drop at least one shipping document file.');
      return;
    }

    el.submitIntakeBtn.disabled = true;
    el.submitIntakeBtn.textContent = 'Uploading Documents...';

    const formData = new FormData();
    formData.append('subject', el.intakeSubject.value.trim());
    if (el.intakeSender.value.trim()) {
      formData.append('sender', el.intakeSender.value.trim());
    }
    if (el.intakeBody.value.trim()) {
      formData.append('body', el.intakeBody.value.trim());
    }
    if (el.intakeProviderId.value.trim()) {
      formData.append('provider_message_id', el.intakeProviderId.value.trim());
    }

    // Check if attaching to existing case
    const isAttaching = state.caseId && el.modeExisting && el.modeExisting.checked;
    if (isAttaching) {
      formData.append('intake_case_id', state.caseId);
    }

    // Append all staged files
    state.stagedFiles.forEach((file) => {
      formData.append('files', file);
    });

    try {
      const res = await api('/api/v1/intakes/simulate', {
        method: 'POST',
        body: formData,
      });

      el.receiptJson.textContent = JSON.stringify(res, null, 2);
      el.receiptBox.classList.remove('hidden');

      // Clear staged files
      clearStagedFiles();

      // Select new case (or reload active case) and advance to Step 2
      const targetCaseId = res.case_id || res.id || state.caseId;
      await loadCases(targetCaseId);
      goToStep(2);
    } catch (err) {
      showError('Simulation Failed', err.message);
    } finally {
      el.submitIntakeBtn.disabled = false;
      updateIntakeTargetUI();
    }
  });

  // STEP 2: PROCESS DOCUMENTS & RUNS
  function renderInvestigation(run) {
    const analysisAvailable = state.analysis?.state === 'available';
    el.investigationBox.classList.toggle('hidden', !run && !analysisAvailable);
    el.investigationSteps.replaceChildren();
    if (!run) {
      el.investigationSummary.textContent = 'No package-count investigation was queued for this revision.';
      return;
    }
    const investigation = run.investigation;
    const labels = {
      pending: 'Investigation queued', running: 'Investigating',
      verified_proposal: 'Evidence agrees. Staff review required.',
      source_counts_differ: 'Source counts differ. Staff review required.',
    };
    const summary = labels[investigation.reason] || labels[investigation.status]
      || 'Staff review required.';
    el.investigationSummary.textContent =
      `${summary} Revision ${run.input_revision} · ${investigation.model || 'Deterministic policy'}`;
    for (const step of investigation.steps) {
      const item = document.createElement('li');
      const result = step.result;
      const details = [];
      if (result?.packing || result?.bill) {
        details.push(`Packing list: ${result.packing?.extracted.value ?? 'missing'} PKG`);
        details.push(`Initial B/L: ${result.bill?.extracted.value ?? 'missing'} PKG`);
      }
      for (const evidence of result?.observations || []) {
        details.push(`${evidence.raw} · page ${evidence.page} · box ${evidence.bbox.join(', ')}`);
      }
      if (result?.outcome) details.push(result.outcome);
      if (step.error) details.push(step.error.replaceAll('_', ' '));
      if (!step.finished_at) details.push('in progress');
      if (result && !details.length) details.push('No package-count evidence');
      const tool = [step.decision.tool, step.decision.profile].filter(Boolean).join(' · ');
      item.textContent = `${tool.replaceAll('_', ' ')} — ${details.join(' | ')}`;
      el.investigationSteps.appendChild(item);
    }
    if (investigation.reason && !labels[investigation.reason] && investigation.status !== 'verified_proposal') {
      el.investigationSummary.append(` · ${investigation.reason.replaceAll('_', ' ')}`);
    }
  }

  async function refreshRuns() {
    const caseId = state.caseId;
    if (!caseId) return false;
    try {
      const caseRuns = await api(`/api/v1/automation/runs?limit=40&intake_case_id=${caseId}`);
      if (caseId !== state.caseId) return false;
      const selected = caseRuns.find((r) =>
        r.stage === 'investigation' && r.input_revision === state.analysis?.revision);
      const detail = selected
        ? await api(`/api/v1/automation/runs/${selected.id}/investigation`)
        : null;
      if (caseId !== state.caseId) return false;
      renderInvestigation(detail);

      el.runsTableBody.innerHTML = '';
      if (caseRuns.length === 0) {
        el.runsTableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No automation runs recorded for this case yet.</td></tr>';
        return false;
      }

      caseRuns.forEach((run) => {
        const tr = document.createElement('tr');
        const retryBtn = run.state === 'failed'
          ? `<button type="button" class="btn btn-sm btn-outline retry-run-btn" data-run-id="${run.id}">Retry</button>`
          : '—';
        tr.innerHTML = `
          <td><span class="font-mono text-xs">${run.id.slice(0, 8)}</span></td>
          <td><strong>${escapeHtml(run.stage)}</strong></td>
          <td><span class="status-pill status-${run.state}">${run.state}</span></td>
          <td>${run.attempt}</td>
          <td><span class="text-xs text-muted">${new Date(run.started_at || run.created_at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Phnom_Penh' })}</span></td>
          <td>${retryBtn}</td>
        `;
        el.runsTableBody.appendChild(tr);
      });

      // Bind retry buttons
      el.runsTableBody.querySelectorAll('.retry-run-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const runId = btn.dataset.runId;
          btn.disabled = true;
          try {
            await api(`/api/v1/automation/runs/${runId}/retry`, { method: 'POST' });
            startPolling();
          } catch (err) {
            showError('Retry Failed', err.message);
          }
        });
      });
      return caseRuns.some((run) => run.input_revision === state.analysis?.revision
        && (run.state === 'queued' || run.state === 'running'));
    } catch (err) {
      console.warn('Could not fetch runs:', err);
      return false;
    }
  }

  el.reprocessBtn.addEventListener('click', async () => {
    if (!state.caseId || !state.analysis) return;
    el.reprocessBtn.disabled = true;
    try {
      await api(`/api/v1/intakes/${state.caseId}/process`, {
        method: 'POST',
        body: { expected_revision: state.analysis.revision },
      });
      startPolling();
    } catch (err) {
      showError('Reprocess Failed', err.message);
    } finally {
      el.reprocessBtn.disabled = false;
    }
  });

  el.btnToStep3.addEventListener('click', () => goToStep(3));

  // STEP 3: DOCUMENT VALIDATION
  function renderValidationStep() {
    if (!state.analysis) return;
    const a = state.analysis;

    // Outcome Pill
    if (a.outcome) {
      el.step3OutcomePill.textContent = a.outcome;
      el.step3OutcomePill.className = `outcome-pill outcome-${a.outcome.toLowerCase()}`;
    }

    // Extracted Documents Overview
    el.documentsSummaryGrid.innerHTML = '';
    const extractions = a.extractions || [];
    if (extractions.length === 0) {
      el.documentsSummaryGrid.innerHTML = '<p class="text-muted">No documents extracted yet.</p>';
    } else {
      extractions.forEach((doc) => {
        const card = document.createElement('div');
        card.className = 'doc-card';
        const roleTitle = doc.role ? doc.role.replace('_', ' ').toUpperCase() : 'DOCUMENT';
        let detailLines = '';
        if (doc.role === 'invoice') {
          const invNo = doc.fields.invoice_no?.value || '—';
          const invDate = doc.fields.invoice_date?.value || '—';
          const supplier = doc.fields.supplier?.value || '—';
          const consignee = doc.fields.consignee?.value || '—';
          const totalVal = doc.fields.amount?.value || doc.fields.total_amount?.value || '—';
          const totalCur = doc.fields.amount?.currency || doc.fields.total_amount?.currency || 'USD';
          detailLines = `
            <div>Invoice No: <strong>${escapeHtml(invNo)}</strong></div>
            <div>Date: ${escapeHtml(invDate)}</div>
            <div>Supplier: ${escapeHtml(supplier)}</div>
            <div>Consignee: ${escapeHtml(consignee)}</div>
            <div>Total: <strong>${escapeHtml(totalVal)} ${escapeHtml(totalCur)}</strong></div>
          `;
        } else if (doc.role === 'packing_list') {
          const pkgs = doc.fields.packages?.value || '—';
          const pkgUnit = doc.fields.packages?.unit || 'PKG';
          const gw = doc.fields.gross_weight?.value || '—';
          const gwUnit = doc.fields.gross_weight?.unit || 'KG';
          const nw = doc.fields.net_weight?.value || '—';
          const nwUnit = doc.fields.net_weight?.unit || 'KG';
          detailLines = `
            <div>Packages: <strong>${escapeHtml(pkgs)}${pkgs !== '—' ? ' ' + escapeHtml(pkgUnit) : ''}</strong></div>
            <div>Gross Weight: ${escapeHtml(gw)}${gw !== '—' ? ' ' + escapeHtml(gwUnit) : ''}</div>
            <div>Net Weight: ${escapeHtml(nw)}${nw !== '—' ? ' ' + escapeHtml(nwUnit) : ''}</div>
          `;
        } else if (doc.role === 'draft_bl') {
          const blNo = doc.fields.bl_no?.value || '—';
          const vessel = doc.fields.vessel?.value || doc.fields.vessel_name?.value || '—';
          const pol = doc.fields.origin?.value || doc.fields.port_of_loading?.value || '—';
          const pod = doc.fields.destination?.value || doc.fields.port_of_discharge?.value || '—';
          const pkgs = doc.fields.packages?.value || '—';
          detailLines = `
            <div>B/L No: <strong>${escapeHtml(blNo)}</strong></div>
            <div>Vessel: ${escapeHtml(vessel)}</div>
            <div>POL: ${escapeHtml(pol)} &rarr; POD: ${escapeHtml(pod)}</div>
            ${pkgs !== '—' ? `<div>Packages: <strong>${escapeHtml(pkgs)} PKG</strong></div>` : ''}
          `;
        }
        card.innerHTML = `
          <div class="doc-card-header">
            <span class="doc-card-title">${roleTitle}</span>
            <span class="text-xs font-mono text-muted">${escapeHtml(doc.document_name || '')}</span>
          </div>
          <div class="text-xs text-muted mt-2">${detailLines}</div>
        `;
        el.documentsSummaryGrid.appendChild(card);
      });
    }

    // AI Advisory Box
    if (a.ai_suggestions && a.ai_suggestions.length > 0) {
      el.aiAdvisoryBox.classList.remove('hidden');
      el.aiModelName.textContent = a.ai_model || 'qwen3.5:4b-q4_K_M (Local Ollama)';
      el.aiSuggestionsList.innerHTML = '';
      a.ai_suggestions.forEach((sug) => {
        const item = document.createElement('div');
        item.className = 'ai-suggestion-item';
        const key = sug.finding_key || 'Advisory';
        const act = sug.suggested_action ? ` [Action: ${sug.suggested_action}]` : '';
        const rel = sug.relationship && sug.relationship !== 'not_applicable' ? ` (${sug.relationship})` : '';
        item.innerHTML = `
          <div><strong>${escapeHtml(key)}</strong><span class="text-xs text-muted font-mono">${escapeHtml(rel)}${escapeHtml(act)}</span></div>
          <div class="mt-1">${escapeHtml(sug.explanation || JSON.stringify(sug))}</div>
        `;
        el.aiSuggestionsList.appendChild(item);
      });
    } else {
      el.aiAdvisoryBox.classList.add('hidden');
    }

    // Commercial Invoice Items Table
    el.invoiceItemsTableBody.innerHTML = '';
    const invoiceDoc = extractions.find((d) => d.role === 'invoice');
    const items = invoiceDoc && invoiceDoc.items ? invoiceDoc.items : [];
    if (items.length === 0) {
      el.invoiceItemsTableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No commercial invoice line items extracted.</td></tr>';
    } else {
      items.forEach((item) => {
        const tr = document.createElement('tr');
        const fields = item.fields || {};
        tr.innerHTML = `
          <td><strong>${item.row}</strong></td>
          <td>${escapeHtml(fields.description?.value || '—')}</td>
          <td>${escapeHtml(fields.quantity?.value || '—')}</td>
          <td>${escapeHtml(fields.unit?.value || '—')}</td>
          <td>${escapeHtml(fields.unit_price?.value || '—')}</td>
          <td><strong>${escapeHtml(fields.amount?.value || '—')}</strong> ${escapeHtml(fields.amount?.currency || '')}</td>
          <td><span class="font-mono text-xs text-muted">${escapeHtml(item.source_locator || `Row ${item.row}`)}</span></td>
        `;
        el.invoiceItemsTableBody.appendChild(tr);
      });
    }

    // Deterministic Findings Table
    renderFindingsTable();
  }

  function findingLabel(finding) {
    const groups = {
      invoice_packing: 'Invoice vs packing list',
      transport: 'Bill of lading',
      validation: 'Document check',
      extraction: 'Extraction',
      cdc: 'CDC',
    };
    const field = finding.field?.replaceAll('_', ' ');
    return [groups[finding.group], field].filter(Boolean).join(' · ') || finding.key;
  }

  function renderFindingsTable() {
    if (!state.analysis) return;
    const findings = state.analysis.findings || [];
    el.findingsCount.textContent = findings.length;

    const filtered = findings.filter((f) => {
      if (state.findingsFilter === 'ALL') return true;
      return f.outcome === state.findingsFilter;
    });

    el.findingsTableBody.innerHTML = '';
    if (filtered.length === 0) {
      el.findingsTableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No findings matching the selected filter.</td></tr>';
      return;
    }

    filtered.forEach((f) => {
      const tr = document.createElement('tr');
      const outcomeClass = f.outcome ? `outcome-${f.outcome.toLowerCase()}` : '';
      const leftVal = f.left || (f.invoice_value != null ? String(f.invoice_value) : '') || '—';
      const rightVal = f.right || (f.comparison_value != null ? String(f.comparison_value) : '') || '—';
      const evidenceList = Array.isArray(f.evidence) ? f.evidence : [];
      const evidenceText = evidenceList
        .map((e) => {
          if (!e) return '';
          if (e.cell) return `${e.sheet ? e.sheet + ' ' : ''}${e.cell}`;
          if (e.line) return `Line ${e.line}`;
          return e.raw || '';
        })
        .filter(Boolean)
        .join(', ') || '—';

      tr.innerHTML = `
        <td><span class="outcome-pill ${outcomeClass}">${f.outcome}</span></td>
        <td><strong>${escapeHtml(findingLabel(f))}</strong></td>
        <td>${escapeHtml(f.explanation || f.description || '—')}</td>
        <td><code>${escapeHtml(leftVal)}</code></td>
        <td><code>${escapeHtml(rightVal)}</code></td>
        <td><span class="text-xs text-muted" title="${escapeHtml(evidenceText)}">${escapeHtml(evidenceText.slice(0, 48))}${evidenceText.length > 48 ? '...' : ''}</span></td>
      `;
      el.findingsTableBody.appendChild(tr);
    });
  }

  el.filterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      el.filterTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.findingsFilter = tab.dataset.filter;
      renderFindingsTable();
    });
  });

  // STEP 4: CDC RECONCILIATION
  async function loadCdcVersions() {
    try {
      const versions = await api('/api/v1/cdc/versions?limit=50');
      state.cdcVersions = Array.isArray(versions) ? versions : [];
      el.cdcVersionSelect.innerHTML = '<option value="">-- Choose a registered Master List --</option>';
      state.cdcVersions.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = `${v.company} · ${v.approval_ref} (${v.year})`;
        el.cdcVersionSelect.appendChild(opt);
      });

      const currentMaster = state.analysis?.selected_master;
      el.cdcVersionSelect.value = currentMaster?.id || '';
      el.selectedMasterPill.textContent = currentMaster
        ? `${currentMaster.company} (${currentMaster.year})`
        : 'Choose a CDC version';
    } catch (err) {
      console.warn('Failed to load CDC versions:', err);
    }
  }

  function renderCdcStep() {
    loadCdcVersions();
    const a = state.analysis;
    if (!a) return;

    // Check company agreement
    const invoiceDoc = (a.extractions || []).find((d) => d.role === 'invoice');
    const consignee = invoiceDoc?.fields?.consignee?.value || '';
    const master = a.selected_master || a.analyzed_master;
    if (consignee && master) {
      el.companyCheckNotice.classList.remove('hidden');
      el.companyCheckNotice.innerHTML = `Consignee on Invoice: <strong>${escapeHtml(consignee)}</strong> | Master List: <strong>${escapeHtml(master.company)}</strong>`;
    } else {
      el.companyCheckNotice.classList.add('hidden');
    }

    // Render Candidates Table
    const candidates = a.candidates || [];
    el.candidateCount.textContent = candidates.length;
    el.candidatesTableBody.innerHTML = '';
    if (candidates.length === 0) {
      el.candidatesTableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No candidate matches available. Please select a Master List and click Apply.</td></tr>';
      return;
    }

    candidates.forEach((c) => {
      const tr = document.createElement('tr');
      const scoreColor = c.score >= 80 ? 'var(--success)' : c.score >= 60 ? 'var(--warning)' : 'var(--danger)';
      tr.innerHTML = `
        <td><strong>Line ${c.invoice_line || c.invoice_row}</strong><div class="text-xs text-muted">${escapeHtml(c.invoice_description || '')}</div></td>
        <td><strong>Row ${c.master_row}</strong></td>
        <td><strong style="color: ${scoreColor}">${Number(c.score).toFixed(1)}%</strong></td>
        <td>${escapeHtml(c.master_description || '—')}</td>
        <td><span class="text-xs text-muted">${escapeHtml(c.evidence || c.reason || '—')}</span></td>
      `;
      el.candidatesTableBody.appendChild(tr);
    });
  }

  el.applyCdcBtn.addEventListener('click', async () => {
    if (!state.caseId || !state.analysis) return;
    const selectedVersionId = el.cdcVersionSelect.value || null;
    el.applyCdcBtn.disabled = true;
    try {
      await api(`/api/v1/intakes/${state.caseId}/cdc-version`, {
        method: 'POST',
        body: {
          expected_revision: state.analysis.revision,
          version_id: selectedVersionId,
        },
      });
      // Move to Step 2 to wait for Celery re-analysis with CDC matching
      startPolling();
      goToStep(2);
    } catch (err) {
      showError('Failed to Apply CDC Version', err.message);
    } finally {
      el.applyCdcBtn.disabled = false;
    }
  });

  el.toggleUploadMasterBtn.addEventListener('click', () => {
    el.registerMasterBox.classList.toggle('hidden');
  });

  el.registerMasterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('masterFile').files[0];
    if (!file) {
      showError('Master List File Required', 'Please select an Excel workbook.');
      return;
    }

    el.submitMasterBtn.disabled = true;
    el.submitMasterBtn.textContent = 'Uploading Master List...';

    const formData = new FormData();
    formData.append('company', document.getElementById('masterCompany').value.trim());
    formData.append('approval_ref', document.getElementById('masterRef').value.trim());
    formData.append('year', document.getElementById('masterYear').value);
    const balanceDate = document.getElementById('masterBalance').value;
    if (balanceDate) formData.append('balance_as_of', balanceDate);
    formData.append('verified', 'true');
    formData.append('file', file);

    try {
      const res = await api('/api/v1/cdc/versions', {
        method: 'POST',
        body: formData,
      });
      el.registerMasterBox.classList.add('hidden');
      await loadCdcVersions();
      el.cdcVersionSelect.value = res.id;
    } catch (err) {
      showError('Registration Failed', err.message);
    } finally {
      el.submitMasterBtn.disabled = false;
      el.submitMasterBtn.textContent = 'Upload & Register Workbook';
    }
  });

  // Cache for full Master List rows to populate Step 5 dropdowns
  const masterItemsCache = new Map();

  async function fetchMasterItems(versionId) {
    if (!versionId) return [];
    if (masterItemsCache.has(versionId)) return masterItemsCache.get(versionId);
    try {
      const pageSize = 100;
      const items = [];
      let total = 0;
      do {
        const query = `limit=${pageSize}&offset=${items.length}`;
        const page = await api(`/api/v1/cdc/versions/${versionId}/items?${query}`);
        total = page.total;
        items.push(...page.items);
        if (!page.items.length && items.length < total) {
          throw new Error('The CDC Master List returned an incomplete page.');
        }
      } while (items.length < total);
      masterItemsCache.set(versionId, items);
      return items;
    } catch (e) {
      showError('Could not load the CDC Master List', e.message);
      return [];
    }
  }

  // STEP 5: STAFF REVIEW & CONFLICT RESOLUTION
  async function renderReviewStep() {
    const caseId = state.caseId;
    const a = state.analysis;
    if (!caseId || !a) return;

    const isCurrent = () => caseId === state.caseId && a.revision === state.analysis?.revision
      && a.state === state.analysis?.state && state.currentStep === 5;
    let reviewRes;
    try {
      reviewRes = await api(`/api/v1/intakes/${caseId}/review`);
    } catch {
      return;
    }
    if (!isCurrent()) return;
    state.reviewData = reviewRes;
    state.latestReview = reviewRes.review;

    const invoiceDoc = (a.extractions || []).find((d) => d.role === 'invoice');
    const invoiceItems = invoiceDoc?.items || [];
    const candidates = a.candidates || [];

    // Pre-populate candidate mappings
    const savedMappings = state.latestReview?.mappings || [];
    const mappingMap = new Map();
    savedMappings.forEach((m) => mappingMap.set(m.invoice_row, m.master_row));

    // Get active master version and all items
    const activeMasterId = a.analyzed_master?.id;
    let allMasterItems = [];
    if (activeMasterId) {
      allMasterItems = await fetchMasterItems(activeMasterId);
    }

    if (!isCurrent()) return;
    el.mappingRowsTableBody.innerHTML = '';
    if (!activeMasterId) {
      el.mappingRowsTableBody.innerHTML = '<tr><td colspan="3">For a CDC permit draft, apply the verified Master List in Step 4.</td></tr>';
    } else if (invoiceItems.length === 0) {
      el.mappingRowsTableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No invoice items to map.</td></tr>';
    } else {
      invoiceItems.forEach((item) => {
        const tr = document.createElement('tr');
        const desc = item.fields.description?.value || `Row ${item.row}`;
        const qty = item.fields.quantity?.value || '—';
        const u = item.fields.unit?.value || '';

        // Find candidate options for this item
        const itemCandidates = candidates
          .filter((c) => (c.invoice_line || c.invoice_row) === item.row)
          .sort((x, y) => (y.score || 0) - (x.score || 0));

        const selectedRow = mappingMap.get(item.row);

        let optionsHtml = '<option value="">-- Choose verified CDC Master Row --</option>';

        if (itemCandidates.length > 0) {
          optionsHtml += '<optgroup label="✨ Best Suggested Matches">';
          itemCandidates.forEach((cand) => {
            const isSelected = selectedRow === cand.master_row;
            optionsHtml += `
              <option value="${cand.master_row}" ${isSelected ? 'selected' : ''}>
                Row ${cand.master_row}: ${escapeHtml(cand.description?.slice(0, 48) || '')} (${Number(cand.score).toFixed(0)}% match)
              </option>
            `;
          });
          optionsHtml += '</optgroup>';
        }

        if (allMasterItems.length > 0) {
          optionsHtml += `<optgroup label="📋 All Master List Items (${allMasterItems.length})">`;
          allMasterItems.forEach((m) => {
            const isSelected = selectedRow === m.row && !itemCandidates.some((c) => c.master_row === m.row);
            const unitLabel = m.unit?.value ? ` [${m.unit.value}]` : '';
            optionsHtml += `
              <option value="${m.row}" ${isSelected ? 'selected' : ''}>
                Row ${m.row}: ${escapeHtml(m.description?.value || '')}${escapeHtml(unitLabel)}
              </option>
            `;
          });
          optionsHtml += '</optgroup>';
        }

        tr.innerHTML = `
          <td><strong>Row ${item.row}:</strong> ${escapeHtml(desc)}</td>
          <td>${escapeHtml(qty)} ${escapeHtml(u)}</td>
          <td>
            <select class="cdc-row-select" data-invoice-row="${item.row}" style="width: 100%; max-width: 420px;">
              ${optionsHtml}
            </select>
          </td>
        `;
        el.mappingRowsTableBody.appendChild(tr);
      });
    }

    // STRICT Reviewable Discrepancy Findings
    // Matches backend shipping_ai/approvals/review.py reviewable set:
    // Only NEEDS_REVIEW findings in group 'transport' or (group 'invoice_packing' and field 'description' without .unpaired.)
    const reviewableFindings = (a.findings || []).filter(
      (f) =>
        f.outcome === 'NEEDS_REVIEW' &&
        (f.group === 'transport' ||
          (f.group === 'invoice_packing' && f.field === 'description' && !f.key.includes('.unpaired.')))
    );

    const savedResolutions = state.latestReview?.resolutions || [];
    const resolutionMap = new Map();
    savedResolutions.forEach((r) => resolutionMap.set(r.key, r.note));

    // Get AI Advisory suggestions (if available)
    const aiSuggestions = a.ai_suggestions || state.latestReview?.ai_suggestions || [];
    const aiSuggestionMap = new Map();
    aiSuggestions.forEach((s) => aiSuggestionMap.set(s.finding_key, s));

    el.resolutionsContainer.innerHTML = '';
    if (reviewableFindings.length === 0) {
      el.resolutionsContainer.innerHTML = '<p class="text-sm text-muted">✓ Zero discrepancies require audit justification notes.</p>';
    } else {
      reviewableFindings.forEach((f) => {
        const card = document.createElement('div');
        card.className = 'resolution-card';
        const savedNote = resolutionMap.get(f.key) || '';
        const aiAdv = aiSuggestionMap.get(f.key);

        card.innerHTML = `
          <div class="resolution-header">
            <strong>${escapeHtml(findingLabel(f))}</strong>
            <span class="outcome-pill outcome-${f.outcome.toLowerCase()}">${f.outcome}</span>
          </div>
          <p class="text-xs text-muted">${escapeHtml(f.explanation || '')}</p>
          <p class="text-sm">Compared values: ${escapeHtml(f.left ?? '—')} / ${escapeHtml(f.right ?? '—')}</p>
          <div class="form-group mt-2">
            <label>What did you verify?</label>
            <input type="text" class="resolution-note-input" data-finding-key="${escapeHtml(f.key)}" value="${escapeHtml(savedNote)}" placeholder="e.g. Carrier port phrasing verified against bill of lading.">
            ${aiAdv?.explanation ? `<p class="text-sm">AI suggestion: ${escapeHtml(aiAdv.explanation)}</p>` : ''}
          </div>
        `;
        el.resolutionsContainer.appendChild(card);
      });

    }

    // Informational Findings & Non-blocking Warnings (Section 3)
    const infoFindings = (a.findings || []).filter(
      (f) => !reviewableFindings.some((rf) => rf.key === f.key) && f.outcome !== 'PASS'
    );

    if (el.infoFindingsBox && el.infoFindingsList) {
      if (infoFindings.length === 0) {
        el.infoFindingsBox.classList.add('hidden');
      } else {
        el.infoFindingsBox.classList.remove('hidden');
        el.infoFindingsList.innerHTML = '';
        infoFindings.forEach((f) => {
          const item = document.createElement('div');
          item.className = 'info-finding-item';
          item.innerHTML = `
            <div class="info-finding-main">
              <div class="info-finding-title">${escapeHtml(findingLabel(f))}</div>
              <div class="info-finding-desc">${escapeHtml(f.explanation || '')}</div>
            </div>
            <span class="outcome-pill outcome-${f.outcome.toLowerCase()}">${f.outcome}</span>
          `;
          el.infoFindingsList.appendChild(item);
        });
      }
    }

    el.verifyCdcCheckbox.checked = Boolean(state.latestReview?.verify_cdc_mappings);
    updateBlockersUI();
  }

  function updateBlockersUI() {
    const r = state.latestReview;
    if (r && r.ready) {
      el.blockersBox.classList.add('hidden');
      el.readyBox.classList.remove('hidden');
      el.btnToStep6.disabled = false;
      el.reviewReadyPill.textContent = 'Ready for Approval';
      el.reviewReadyPill.className = 'status-pill status-ready_for_approval';
    } else {
      el.readyBox.classList.add('hidden');
      el.blockersBox.classList.remove('hidden');
      el.btnToStep6.disabled = true;
      el.reviewReadyPill.textContent = 'Needs Review';
      el.reviewReadyPill.className = 'status-pill status-needs_review';

      const blockers = r?.blockers || ['Save Staff Review to check what still needs attention.'];
      el.blockersCount.textContent = blockers.length;
      el.blockersList.innerHTML = '';
      blockers.forEach((b) => {
        const li = document.createElement('li');
        li.textContent = b;
        el.blockersList.appendChild(li);
      });
    }
  }

  el.staffReviewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.caseId || !state.analysis) return;

    // Collect mappings
    const mappings = [];
    const selects = el.mappingRowsTableBody.querySelectorAll('.cdc-row-select');
    selects.forEach((sel) => {
      const invRow = parseInt(sel.dataset.invoiceRow, 10);
      const masterRow = parseInt(sel.value, 10);
      if (invRow && masterRow) {
        mappings.push({ invoice_row: invRow, master_row: masterRow });
      }
    });

    // Collect resolutions ONLY from reviewable inputs in resolutionsContainer
    const resolutions = [];
    const noteInputs = el.resolutionsContainer.querySelectorAll('.resolution-note-input');
    noteInputs.forEach((inp) => {
      const key = inp.dataset.findingKey;
      const note = inp.value.trim();
      if (key && note) {
        resolutions.push({ key, note });
      }
    });

    const verifyCdc = el.verifyCdcCheckbox.checked;

    el.saveReviewBtn.disabled = true;
    el.saveReviewBtn.textContent = 'Saving Review...';

    try {
      const res = await api(`/api/v1/intakes/${state.caseId}/review`, {
        method: 'POST',
        body: {
          expected_revision: state.analysis.revision,
          expected_review_id: state.latestReview ? state.latestReview.id : null,
          mappings,
          resolutions,
          verify_cdc_mappings: verifyCdc,
          corrections: [],
        },
      });

      state.latestReview = res;
      updateBlockersUI();
      if (res.ready) {
        goToStep(6);
      }
    } catch (err) {
      showError('Review Save Blocked', err.message);
    } finally {
      el.saveReviewBtn.disabled = false;
      el.saveReviewBtn.textContent = 'Save Staff Review';
    }
  });

  el.btnToStep6.addEventListener('click', () => goToStep(6));

  // STEP 6: APPROVE IMPORT GATE
  function renderApprovalStep() {
    if (!state.caseId || !state.analysis) return;
    const r = state.latestReview;
    const isApproved = state.caseDetail?.state === 'approved';

    el.snapRev.textContent = state.analysis.revision;
    el.snapHash.textContent = r?.snapshot_hash || 'Pending Save';

    if (isApproved) {
      if (el.alreadyApprovedNotice) el.alreadyApprovedNotice.classList.remove('hidden');
      el.approvalGateWarning.classList.add('hidden');
      el.approvalForm.classList.add('hidden');
      el.step6StatePill.textContent = 'Approved';
      el.step6StatePill.className = 'status-pill status-approved';
    } else if (!r || !r.ready) {
      if (el.alreadyApprovedNotice) el.alreadyApprovedNotice.classList.add('hidden');
      el.approvalGateWarning.classList.remove('hidden');
      el.approvalForm.classList.remove('hidden');
      el.approveBtn.disabled = true;
      el.step6StatePill.textContent = 'Blocked';
      el.step6StatePill.className = 'status-pill status-needs_review';
    } else {
      if (el.alreadyApprovedNotice) el.alreadyApprovedNotice.classList.add('hidden');
      el.approvalGateWarning.classList.add('hidden');
      el.approvalForm.classList.remove('hidden');
      el.approveBtn.disabled = false;
      el.step6StatePill.textContent = 'Ready for Approval';
      el.step6StatePill.className = 'status-pill status-ready_for_approval';
    }

    el.snapPermitPending.textContent = r?.permit_pending || 'Eligible at approval';
  }

  if (el.goToStep7FromApprovedBtn) {
    el.goToStep7FromApprovedBtn.addEventListener('click', () => goToStep(7));
  }

  el.approvalForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.caseId || !state.analysis || !state.latestReview) return;

    el.approveBtn.disabled = true;
    el.approveBtn.textContent = 'Committing Business Record...';

    try {
      await api(`/api/v1/intakes/${state.caseId}/approve`, {
        method: 'POST',
        body: {
          expected_revision: state.analysis.revision,
          review_id: state.latestReview.id,
          notes: el.approvalNotes.value.trim(),
        },
      });

      // Update case and navigate to results
      await selectCase(state.caseId);
      goToStep(7);
    } catch (err) {
      showError('Approval Failed', err.message);
    } finally {
      el.approveBtn.disabled = false;
      el.approveBtn.textContent = 'Approve Import & Commit Business Record →';
    }
  });

  el.rejectBtn.addEventListener('click', async () => {
    if (!state.caseId || !state.analysis) return;
    if (!confirm('Are you sure you want to REJECT this intake case?')) return;

    el.rejectBtn.disabled = true;
    try {
      await api(`/api/v1/intakes/${state.caseId}/reject`, {
        method: 'POST',
        body: {
          expected_revision: state.analysis.revision,
          review_id: state.latestReview ? state.latestReview.id : null,
          notes: el.approvalNotes.value.trim() || 'Rejected by staff.',
        },
      });
      await selectCase(state.caseId);
    } catch (err) {
      showError('Reject Failed', err.message);
    } finally {
      el.rejectBtn.disabled = false;
    }
  });

  // STEP 7: GENERATED RESULTS & PERMITS
  async function renderResultsStep() {
    if (!state.caseId || !state.caseDetail) return;
    const importId = state.caseDetail.import_id;
    if (!importId) {
      el.importOverviewGrid.innerHTML = '<p class="text-muted">Import record has not been committed yet. Please approve the intake in Step 6.</p>';
      return;
    }

    try {
      if (!state.reviewData && state.caseId) {
        try {
          state.reviewData = await api(`/api/v1/intakes/${state.caseId}/review`);
        } catch {}
      }

      const record = await api(`/api/v1/imports/${importId}`);
      state.importRecord = record;

      // Render overview cells
      el.importOverviewGrid.innerHTML = `
        <div class="overview-cell"><label>Invoice No</label><span>${escapeHtml(record.invoice_no)}</span></div>
        <div class="overview-cell"><label>Consignee</label><span>${escapeHtml(record.consignee)}</span></div>
        <div class="overview-cell"><label>Supplier</label><span>${escapeHtml(record.supplier || '—')}</span></div>
        <div class="overview-cell"><label>Approved At</label><span>${new Date(record.approved_at).toLocaleString()}</span></div>
        <div class="overview-cell"><label>ETD Status</label><span>${escapeHtml(record.etd_status || '—')}</span></div>
        <div class="overview-cell"><label>ETA Status</label><span>${escapeHtml(record.eta_status || '—')}</span></div>
      `;

      // Render items
      const items = record.items || [];
      el.approvedItemsCount.textContent = items.length;
      el.approvedItemsTableBody.innerHTML = '';
      items.forEach((item) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong>${item.line_no}</strong></td>
          <td>${escapeHtml(item.normalized_description || item.raw_description)}</td>
          <td>${escapeHtml(String(item.quantity))}</td>
          <td>${escapeHtml(item.unit || '')}</td>
          <td>${escapeHtml(String(item.unit_price))}</td>
          <td><strong>${escapeHtml(String(item.amount))}</strong></td>
          <td>${escapeHtml(item.currency || 'USD')}</td>
          <td><span class="badge" style="background:#dcfce7;color:#15803d">${escapeHtml(item.verification_state)}</span></td>
        `;
        el.approvedItemsTableBody.appendChild(tr);
      });

      // Load permit drafts
      await loadPermitDrafts(importId);
    } catch (err) {
      console.error('Failed to load import record:', err);
    }
  }

  async function loadPermitDrafts(importId) {
    try {
      const drafts = await api(`/api/v1/imports/${importId}/permit-drafts`);
      state.permitDrafts = Array.isArray(drafts) ? drafts : [];

      el.permitDraftsTableBody.innerHTML = '';
      if (state.permitDrafts.length === 0) {
        let pendingReason =
          state.latestReview?.permit_pending ||
          (state.reviewData?.decisions && state.reviewData.decisions.find((d) => d.permit_pending)?.permit_pending);

        el.permitDraftsTableBody.innerHTML = `
          <tr>
            <td colspan="5" style="padding: 16px;">
              <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid #f59e0b; border-radius: 6px; padding: 12px 16px; color: #92400e;">
                <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">⚠️ Customs Permit Draft Pending: ${escapeHtml(pendingReason || 'Requires customs template verification')}</div>
                <div style="font-size: 12px; color: #78350f;">
                  Staff approved the internal import record and the reviewed items shown above.
                  Automated export of the customs <code>.xlsx</code> application sheet is held until the condition above is satisfied.
                </div>
              </div>
            </td>
          </tr>
        `;

        if (el.authReleaseBtn) el.authReleaseBtn.disabled = true;
        if (el.brokerEmail) el.brokerEmail.disabled = true;
        if (el.releaseNotes) el.releaseNotes.disabled = true;
        if (el.brokerReleaseBox) {
          let notice = el.brokerReleaseBox.querySelector('.release-disabled-notice');
          if (!notice) {
            notice = document.createElement('div');
            notice.className = 'release-disabled-notice';
            notice.style.marginTop = '12px';
            notice.style.fontSize = '12px';
            notice.style.color = '#b45309';
            notice.style.background = '#fffbeb';
            notice.style.border = '1px solid #fcd34d';
            notice.style.borderRadius = '4px';
            notice.style.padding = '8px 12px';
            notice.innerHTML = `🔒 <strong>Broker Release Locked:</strong> An outbound broker release cannot be authorized until an approved customs permit draft (.xlsx) is generated.`;
            el.brokerReleaseBox.appendChild(notice);
          }
        }
        return;
      }

      if (el.authReleaseBtn) el.authReleaseBtn.disabled = false;
      if (el.brokerEmail) el.brokerEmail.disabled = false;
      if (el.releaseNotes) el.releaseNotes.disabled = false;
      const notice = el.brokerReleaseBox?.querySelector('.release-disabled-notice');
      if (notice) notice.remove();

      const currentDraft = state.permitDrafts.find((d) => d.current) || state.permitDrafts[0];
      if (currentDraft && currentDraft.recipient) {
        el.brokerEmail.value = currentDraft.recipient;
        el.releaseSuccessMsg.textContent = `✓ Broker release previously authorized for ${currentDraft.recipient}.`;
        el.releaseSuccessMsg.classList.remove('hidden');
      } else {
        el.releaseSuccessMsg.classList.add('hidden');
      }

      state.permitDrafts.forEach((draft) => {
        const tr = document.createElement('tr');
        const dlUrl = `/api/v1/imports/${importId}/permit-drafts/${draft.id}/download`;
        const brokerRelease = draft.recipient
          ? `<span class="badge" style="background:#dcfce7;color:#15803d">Release authorized for ${escapeHtml(draft.recipient)}</span>`
          : '<span class="badge" style="background:#fef3c7;color:#b45309">Awaiting release authorization</span>';

        tr.innerHTML = `
          <td><span class="font-mono text-xs">${draft.id.slice(0, 8)}</span></td>
          <td>Rev ${draft.revision}</td>
          <td>${draft.current ? '<span class="status-pill status-approved">Current</span>' : '<span class="status-pill status-queued">Superseded</span>'}</td>
          <td>${brokerRelease}</td>
          <td><a href="${dlUrl}" class="btn btn-sm btn-outline" download>📥 Download .xlsx</a></td>
        `;
        el.permitDraftsTableBody.appendChild(tr);
      });
    } catch (err) {
      console.warn('Failed to load permit drafts:', err);
    }
  }

  el.brokerReleaseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.caseDetail?.import_id || state.permitDrafts.length === 0) {
      showError('No Permit Draft Available', 'Cannot authorize broker release without a generated permit draft.');
      return;
    }

    const currentDraft = state.permitDrafts.find((d) => d.current) || state.permitDrafts[0];
    const importId = state.caseDetail.import_id;

    el.authReleaseBtn.disabled = true;
    try {
      const res = await api(`/api/v1/imports/${importId}/permit-drafts/${currentDraft.id}/release`, {
        method: 'POST',
        body: {
          recipient: el.brokerEmail.value.trim(),
          notes: el.releaseNotes.value.trim(),
        },
      });

      el.releaseSuccessMsg.textContent = `✓ Broker release authorized for ${res.recipient}. Outbound authorization recorded in audit log.`;
      el.releaseSuccessMsg.classList.remove('hidden');
      await loadPermitDrafts(importId);
    } catch (err) {
      showError('Broker Authorization Failed', err.message);
    } finally {
      el.authReleaseBtn.disabled = false;
    }
  });

  el.startNewIntakeBtn.addEventListener('click', () => {
    resetCase();
    goToStep(1);
  });

  // Utility to prevent XSS
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Initialize on page load
  async function init() {
    await checkAuth();
    await loadCases();
    goToStep(1);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
