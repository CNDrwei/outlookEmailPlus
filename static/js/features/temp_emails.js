        // ==================== 临时邮箱相关 ====================

        let selectedTempEmailAddresses = new Set();

        let tempEmailOptionsCache = new Map();
        let tempEmailOptionsState = new Map();
        let tempEmailOptionsRequestSeq = 0;

        // BUG-05: 快速切换临时邮箱/从普通邮箱切换到临时邮箱时，旧请求与轮询可能污染当前 UI。
        // - tempEmailMessagesRequestSeq / tempEmailDetailRequestSeq 用于丢弃过期请求的响应（stale guard）。
        // - selectTempEmail 主动 stopAllPolls，避免轮询继续跑 /api/emails 导致报错与串号。
        let tempEmailMessagesRequestSeq = 0;
        let tempEmailDetailRequestSeq = 0;

        function getTempEmailOptionsProviderName(providerName = null) {
            const explicitProvider = String(providerName || '').trim();
            if (explicitProvider) return explicitProvider;
            const providerSelect = document.getElementById('tempEmailProviderSelect');
            return providerSelect && providerSelect.value ? providerSelect.value.trim() : '';
        }

        function getTempEmailOptionsCacheKey(providerName) {
            return getTempEmailOptionsProviderName(providerName) || '__default__';
        }

        function getTempEmailProviderDisplayLabel(providerName, options) {
            const select = document.getElementById('tempEmailProviderSelect');
            if (select) {
                const matchedOption = Array.from(select.options).find(option => option.value === providerName);
                if (matchedOption && matchedOption.textContent) {
                    return matchedOption.textContent.trim();
                }
            }
            return String((options && (options.provider_label || options.provider_name)) || providerName || translateAppTextLocal('当前 Provider'));
        }

        function supportsManualDomainSelection(options, domains) {
            if (!domains.length) return false;
            const strategy = String((options && options.domain_strategy) || '').trim().toLowerCase();
            if (!strategy) return true;
            return strategy === 'manual' || strategy === 'manual_only' || strategy === 'auto_or_manual';
        }

        async function loadTempEmailOptions(forceRefresh = false, providerName = null) {
            const resolvedProviderName = getTempEmailOptionsProviderName(providerName);
            const cacheKey = getTempEmailOptionsCacheKey(resolvedProviderName);
            const requestSeq = ++tempEmailOptionsRequestSeq;

            if (!forceRefresh && tempEmailOptionsCache.has(cacheKey)) {
                const cachedOptions = tempEmailOptionsCache.get(cacheKey);
                renderTempEmailOptions({ status: 'loaded', options: cachedOptions, providerName: resolvedProviderName });
                return cachedOptions;
            }

            try {
                const url = resolvedProviderName
                    ? `/api/temp-emails/options?provider_name=${encodeURIComponent(resolvedProviderName)}`
                    : '/api/temp-emails/options';
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const data = await response.json();
                if (data.success && data.options) {
                    tempEmailOptionsState.set(cacheKey, 'loaded');
                    tempEmailOptionsCache.set(cacheKey, data.options);
                    if (requestSeq === tempEmailOptionsRequestSeq && getTempEmailOptionsProviderName() === resolvedProviderName) {
                        renderTempEmailOptions({ status: 'loaded', options: data.options, providerName: resolvedProviderName });
                    }
                    return data.options;
                }
                throw new Error(
                    window.resolveApiErrorMessage
                        ? window.resolveApiErrorMessage(data.error || data, '加载失败', 'Load failed')
                        : (data.error && data.error.message ? data.error.message : '加载失败')
                );
            } catch (error) {
                tempEmailOptionsState.set(cacheKey, 'error');
                console.error('加载临时邮箱配置失败:', error);
                if (requestSeq === tempEmailOptionsRequestSeq && getTempEmailOptionsProviderName() === resolvedProviderName) {
                    renderTempEmailOptions({
                        status: 'error',
                        providerName: resolvedProviderName,
                        errorMessage: error && error.message ? error.message : translateAppTextLocal('请检查临时邮箱 options 接口')
                    });
                    showToast(translateAppTextLocal('临时邮箱配置加载失败'), 'warning');
                }
                return null;
            }
        }

        function renderTempEmailOptions(payload) {
            const domainSelect = document.getElementById('tempEmailDomainSelect');
            const hint = document.getElementById('tempEmailOptionsHint');
            const status = document.getElementById('tempEmailOptionsStatus');
            if (!domainSelect) return;

            const renderStatus = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'status')
                ? payload.status
                : 'loaded';
            const options = renderStatus === 'loaded' && payload ? payload.options : null;
            const providerName = getTempEmailOptionsProviderName(payload && payload.providerName ? payload.providerName : null);
            const providerLabel = getTempEmailProviderDisplayLabel(providerName, options);
            const domains = Array.isArray(options?.domains) ? options.domains.filter(item => item && item.enabled !== false) : [];
            const canSelectDomainManually = supportsManualDomainSelection(options, domains);

            if (renderStatus === 'error') {
                domainSelect.disabled = true;
                domainSelect.innerHTML = `<option value="">${escapeHtml(translateAppTextLocal('域名配置加载失败'))}</option>`;
                if (hint) {
                    hint.textContent = translateAppTextLocal('无法读取当前 Provider 的域名配置。');
                }
                if (status) {
                    status.textContent = payload.errorMessage || translateAppTextLocal('请检查 /api/temp-emails/options 接口是否可用。');
                    status.style.display = 'block';
                }
                return;
            }

            const prevDomainValue = domainSelect.value;
            if (status) {
                status.textContent = '';
                status.style.display = 'none';
            }

            if (!canSelectDomainManually) {
                domainSelect.disabled = true;
                domainSelect.innerHTML = `<option value="">${escapeHtml(translateAppTextLocal('自动分配域名'))}</option>`;
                domainSelect.value = '';
                if (hint) {
                    hint.textContent = domains.length > 0
                        ? `${providerLabel}${translateAppTextLocal(' 当前由服务端自动分配域名。')}`
                        : `${providerLabel}${translateAppTextLocal(' 当前未提供可选域名，域名将由服务端自动分配。')}`;
                }
                return;
            }

            domainSelect.disabled = false;
            // BUG-07: 重建 innerHTML 前先保存当前选中值，重建后再恢复。
            // 否则每次 loadTempEmails/renderTempEmailOptions 都会把用户选好的域名重置回"自动分配"。
            domainSelect.innerHTML = [
                `<option value="">${escapeHtml(translateAppTextLocal('自动分配域名'))}</option>`,
                ...domains.map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`)
            ].join('');
            if (prevDomainValue && domains.some(d => d.name === prevDomainValue)) {
                domainSelect.value = prevDomainValue;
            }

            if (hint) {
                hint.textContent = `${translateAppTextLocal('可用域名：')}${domains.map(item => item.name).join(' / ')}`;
            }
        }

        // 复制临时邮箱页面顶栏当前邮箱地址
        function copyTempEmailCurrent() {
            const el = document.getElementById('tempEmailCurrentName');
            if (el && el.textContent && el.textContent !== '选择一个临时邮箱') {
                copyEmail(el.textContent.trim());
            }
        }

        // 加载临时邮箱列表
        async function loadTempEmails(forceRefresh = false) {
            const container = document.getElementById('accountList');
            const pageContainer = document.getElementById('tempEmailContainer');

            const providerSelect = document.getElementById('tempEmailProviderSelect');
            if (providerSelect) {
                loadTempEmailOptions(forceRefresh, providerSelect.value);
                const importBtn = document.getElementById('importCfTempEmailBtn');
                if (importBtn) {
                    importBtn.style.display = providerSelect.value === 'cloudflare_temp_mail' ? '' : 'none';
                }
            }

            if (!forceRefresh && accountsCache['temp']) {
                renderTempEmailList(accountsCache['temp']);
                return;
            }

            const loadingHTML = `<div class="loading-overlay"><span class="spinner"></span> ${translateAppTextLocal('加载中…')}</div>`;
            if (container) container.innerHTML = loadingHTML;
            if (pageContainer) pageContainer.innerHTML = loadingHTML;

            try {
                const response = await fetch('/api/temp-emails');
                const data = await response.json();

                if (data.success) {
                    accountsCache['temp'] = data.emails;
                    renderTempEmailList(data.emails);

                    const group = groups.find(g => g.name === '临时邮箱');
                    if (group) {
                        group.account_count = data.emails.length;
                        renderGroupList(groups);
                    }
                }
            } catch (error) {
                const errHTML = `<div class="empty-state"><p>${translateAppTextLocal('加载失败')}</p></div>`;
                if (container) container.innerHTML = errHTML;
                if (pageContainer) pageContainer.innerHTML = errHTML;
            }
        }

        function updateTempEmailBatchActionBar() {
            const bar = document.getElementById('tempEmailBatchActionBar');
            const countSpan = document.getElementById('tempEmailSelectedCount');
            if (!bar || !countSpan) return;

            if (selectedTempEmailAddresses.size > 0) {
                bar.style.display = 'flex';
                countSpan.textContent = typeof formatSelectedItemsLabel === 'function'
                    ? formatSelectedItemsLabel(selectedTempEmailAddresses.size)
                    : `已选 ${selectedTempEmailAddresses.size} 项`;
            } else {
                bar.style.display = 'none';
            }
        }

        function updateTempEmailSelectAllCheckbox() {
            const selectAll = document.getElementById('tempEmailSelectAll');
            if (!selectAll) return;

            const checkboxes = document.querySelectorAll('.temp-email-select-checkbox');
            if (!checkboxes.length) {
                selectAll.checked = false;
                selectAll.indeterminate = false;
                return;
            }

            const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
            selectAll.checked = checkedCount > 0 && checkedCount === checkboxes.length;
            selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
        }

        function toggleTempEmailSelection(email, checked) {
            const normalized = String(email || '').trim();
            if (!normalized) return;
            if (checked) {
                selectedTempEmailAddresses.add(normalized);
            } else {
                selectedTempEmailAddresses.delete(normalized);
            }
            updateTempEmailBatchActionBar();
            updateTempEmailSelectAllCheckbox();
        }

        function toggleSelectAllTempEmails(checked) {
            const checkboxes = document.querySelectorAll('.temp-email-select-checkbox');
            checkboxes.forEach((checkbox) => {
                checkbox.checked = !!checked;
                toggleTempEmailSelection(checkbox.value, !!checked);
            });
            updateTempEmailSelectAllCheckbox();
        }

        function clearTempEmailSelection() {
            selectedTempEmailAddresses.clear();
            document.querySelectorAll('.temp-email-select-checkbox').forEach((checkbox) => {
                checkbox.checked = false;
            });
            updateTempEmailBatchActionBar();
            updateTempEmailSelectAllCheckbox();
        }

        function resetTempEmailDetailIfDeleted(emailSet) {
            if (!currentAccount || !emailSet.has(currentAccount)) return;

            currentAccount = null;
            currentEmails = [];
            currentEmailDetail = null;
            isTrustedMode = false;

            const currentAccountBar = document.getElementById('currentAccountBar');
            if (currentAccountBar) currentAccountBar.style.display = 'none';

            const emptyMailboxHTML = `
                <div class="empty-state">
                    <span class="empty-icon">📬</span><p>请从左侧选择一个邮箱账号</p>
                </div>
            `;
            const emailList = document.getElementById('emailList');
            if (emailList) emailList.innerHTML = emptyMailboxHTML;

            const tempMessageList = document.getElementById('tempEmailMessageList');
            if (tempMessageList) {
                tempMessageList.innerHTML = `
                    <div class="empty-state">
                        <span class="empty-icon">📬</span>
                        <p>选择一个临时邮箱查看邮件</p>
                    </div>
                `;
            }

            const tempName = document.getElementById('tempEmailCurrentName');
            if (tempName) tempName.textContent = translateAppTextLocal('选择一个临时邮箱');

            const tempRefreshBtn = document.getElementById('tempEmailRefreshBtn');
            if (tempRefreshBtn) tempRefreshBtn.style.display = 'none';

            if (typeof resetEmailDetailState === 'function') {
                resetEmailDetailState({ source: 'temp' });
            }
        }

        // 渲染临时邮箱列表
        function renderTempEmailList(emails) {
            const container = document.getElementById('accountList');
            const pageContainer = document.getElementById('tempEmailContainer');
            const visibleEmails = new Set((emails || []).map(item => String(item.email || '').trim()).filter(Boolean));
            selectedTempEmailAddresses = new Set(
                Array.from(selectedTempEmailAddresses).filter(email => visibleEmails.has(email))
            );

            if (emails.length === 0) {
                clearTempEmailSelection();
                const emptyAccountHTML = `
                    <div class="empty-state">
                        <span class="empty-icon">⚡</span>
                        <p>${translateAppTextLocal('暂无临时邮箱')}<br>${translateAppTextLocal('点击按钮生成')}</p>
                    </div>
                `;
                const emptyPageHTML = `
                    <div class="empty-state">
                        <span class="empty-icon">📭</span>
                        <p>${translateAppTextLocal('暂无临时邮箱')}</p>
                        <button class="btn btn-primary" onclick="generateTempEmail()">${translateAppTextLocal('创建第一个临时邮箱')}</button>
                    </div>
                `;
                if (container) container.innerHTML = emptyAccountHTML;
                if (pageContainer) pageContainer.innerHTML = emptyPageHTML;
                return;
            }

            const colors = ['var(--clr-accent)', 'var(--clr-jade)', 'var(--clr-primary)', '#6C5CE7', '#00B894', '#E17055'];

            const cardHTML = emails.map((email, idx) => {
                const initial = (email.email || '?')[0].toUpperCase();
                const color = colors[idx % colors.length];
                const isChecked = selectedTempEmailAddresses.has(email.email);
                return `
                <div class="account-card ${currentAccount === email.email ? 'active' : ''}"
                     onclick="selectTempEmail('${escapeJs(email.email)}')">
                    <div class="account-card-top">
                        <input type="checkbox" class="account-select-checkbox temp-email-select-checkbox" value="${escapeHtml(email.email)}"
                               ${isChecked ? 'checked' : ''}
                               onclick="event.stopPropagation(); toggleTempEmailSelection('${escapeJs(email.email)}', this.checked)">
                        <div class="account-avatar" style="background:${color};">${initial}</div>
                        <div class="account-info">
                            <div class="account-email" onclick="event.stopPropagation(); copyEmail('${escapeJs(email.email)}')" style="cursor:pointer;" title="点击复制">${escapeHtml(email.email)}</div>
                            <div style="font-size:0.72rem;color:var(--text-muted);">${translateAppTextLocal('⚡ 临时邮箱')}</div>
                        </div>
                    </div>
                    <div class="account-card-bottom">
                        <div class="account-actions">
                            <button class="btn btn-sm btn-accent" onclick="event.stopPropagation(); copyVerificationInfo('${escapeJs(email.email)}', this, { source: 'temp' })" title="提取验证码" style="font-size:0.72rem;padding:2px 8px;">🔑 验证码</button>
                            <button class="btn-icon" onclick="event.stopPropagation(); copyEmail('${escapeJs(email.email)}')" title="复制">📋</button>
                            <button class="btn-icon" onclick="event.stopPropagation(); clearTempEmailMessages('${escapeJs(email.email)}')" title="清空">🧹</button>
                            <button class="btn-icon" onclick="event.stopPropagation(); deleteTempEmail('${escapeJs(email.email)}')" title="删除" style="color:var(--clr-danger);">🗑️</button>
                        </div>
                    </div>
                </div>
            `}).join('');

            if (container) container.innerHTML = cardHTML;
            if (pageContainer) pageContainer.innerHTML = cardHTML;
            updateTempEmailBatchActionBar();
            updateTempEmailSelectAllCheckbox();
        }

        // 生成临时邮箱
        function onTempEmailProviderChange(selectedProvider) {
            loadTempEmailOptions(false, selectedProvider);
            const importBtn = document.getElementById('importCfTempEmailBtn');
            if (importBtn) {
                const isCf = String(selectedProvider || '').trim() === 'cloudflare_temp_mail';
                importBtn.style.display = isCf ? '' : 'none';
            }
        }

        function showImportCfTempEmailModal() {
            const providerSelect = document.getElementById('tempEmailProviderSelect');
            const providerName = providerSelect ? providerSelect.value.trim() : 'cloudflare_temp_mail';
            if (providerName !== 'cloudflare_temp_mail') {
                showToast(translateAppTextLocal('请先选择 Cloudflare Temp Mail Provider'), 'warning');
                return;
            }

            const domainInput = document.getElementById('importCfTempEmailDomain');
            const domainSelect = document.getElementById('tempEmailDomainSelect');
            const textarea = document.getElementById('importCfTempEmailInput');
            const cacheKey = getTempEmailOptionsCacheKey(providerName);
            const options = tempEmailOptionsCache.get(cacheKey);
            const domains = Array.isArray(options?.domains) ? options.domains.filter(item => item && item.enabled !== false) : [];

            if (domainInput) {
                const selectedDomain = domainSelect && !domainSelect.disabled ? (domainSelect.value || '').trim() : '';
                const defaultDomain = domains.find(item => item.is_default)?.name || domains[0]?.name || '';
                domainInput.value = selectedDomain || defaultDomain || domainInput.value || '';
            }
            if (textarea) {
                textarea.value = '';
            }
            document.getElementById('importCfTempEmailModal').classList.add('show');
        }

        function hideImportCfTempEmailModal() {
            document.getElementById('importCfTempEmailModal').classList.remove('show');
        }

        function countCfTempEmailImportLines(addressText) {
            return String(addressText || '')
                .split('\n')
                .filter((line) => {
                    const trimmed = line.trim();
                    return trimmed && !trimmed.startsWith('#');
                }).length;
        }

        async function importCfTempEmails() {
            const domain = (document.getElementById('importCfTempEmailDomain')?.value || '').trim();
            const addressText = (document.getElementById('importCfTempEmailInput')?.value || '').trim();
            const providerSelect = document.getElementById('tempEmailProviderSelect');
            const providerName = providerSelect ? (providerSelect.value || 'cloudflare_temp_mail').trim() : 'cloudflare_temp_mail';
            const submitBtn = document.getElementById('importCfTempEmailSubmitBtn');
            const cancelBtn = document.getElementById('importCfTempEmailCancelBtn');
            const hintEl = document.getElementById('importCfTempEmailHint');
            const defaultHint = '格式：每行一个前缀（推荐）或完整邮箱。未带 JWT 的地址会先快速落库，首次取信时再从 CF Worker 同步凭据；若已知 JWT 可用 `前缀----JWT` 格式。';

            if (!domain) {
                showToast(translateAppTextLocal('请指定域名'), 'error');
                return;
            }
            if (!addressText) {
                showToast(translateAppTextLocal('请输入要导入的邮箱'), 'error');
                return;
            }

            const lineCount = countCfTempEmailImportLines(addressText);
            const originalSubmitText = submitBtn ? submitBtn.textContent : '';
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = translateAppTextLocal(`导入中… (${lineCount} 个)`);
            }
            if (cancelBtn) cancelBtn.disabled = true;
            if (hintEl) {
                hintEl.textContent = translateAppTextLocal(`正在导入 ${lineCount} 个邮箱，请稍候…`);
            }

            try {
                const response = await fetch('/api/temp-emails/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        domain,
                        address_string: addressText,
                        provider_name: providerName
                    })
                });
                const data = await response.json();

                if (data.success) {
                    showToast(pickApiMessage(data, data.message, 'Import completed'), 'success');
                    hideImportCfTempEmailModal();
                    delete accountsCache['temp'];
                    loadTempEmails(true);
                    return;
                }

                let message = pickApiMessage(data, data.message || '导入失败', data.message_en || 'Import failed');
                const errors = Array.isArray(data.errors) ? data.errors : [];
                if (errors.length > 0) {
                    const first = errors[0] || {};
                    const detail = first.error || first.message || '';
                    if (detail) {
                        message += first.line ? `\n第 ${first.line} 行：${detail}` : `\n${detail}`;
                    }
                }
                showToast(message, 'error', data.error || data);
            } catch (error) {
                showToast(translateAppTextLocal('导入失败'), 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalSubmitText || translateAppTextLocal('导入');
                }
                if (cancelBtn) cancelBtn.disabled = false;
                if (hintEl) hintEl.textContent = defaultHint;
            }
        }

        async function generateTempEmail() {
            try {
                const prefixInput = document.getElementById('tempEmailPrefixInput');
                const domainSelect = document.getElementById('tempEmailDomainSelect');
                const providerSelect = document.getElementById('tempEmailProviderSelect');
                const payload = {};
                if (prefixInput && prefixInput.value.trim()) {
                    payload.prefix = prefixInput.value.trim();
                }
                if (domainSelect && domainSelect.value.trim() && !domainSelect.disabled) {
                    payload.domain = domainSelect.value.trim();
                }
                if (providerSelect && providerSelect.value.trim()) {
                    payload.provider_name = providerSelect.value.trim();
                }
                showToast('正在生成临时邮箱…', 'info');
                const response = await fetch('/api/temp-emails/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (data.success) {
                    showToast(`临时邮箱已生成: ${data.email}`, 'success');
                    if (prefixInput) prefixInput.value = '';
                    delete accountsCache['temp'];
                    // BUG-06: 不调用 loadGroups()，因为 loadTempEmails 内部已更新分组徽章。
                    // loadGroups() 在 currentGroupId 为 null 时会触发 selectGroup()，
                    // 进而清空 currentAccount，导致当前选中临时邮箱被意外重置。
                    loadTempEmails(true);
                } else {
                    handleApiError(data, '生成临时邮箱失败');
                }
            } catch (error) {
                showToast('生成临时邮箱失败', 'error');
            }
        }

        // 选择临时邮箱
        function selectTempEmail(email) {
            // BUG-05: 切换到临时邮箱前停止所有轮询，避免轮询把 currentAccount 误当作普通邮箱去拉取。
            if (typeof stopAllPolls === 'function') {
                stopAllPolls();
            }

            currentAccount = email;
            isTempEmailGroup = true;
            currentEmailDetail = null;
            isTrustedMode = false;

            // Update mailbox page bar (if visible)
            const bar = document.getElementById('currentAccountBar');
            if (bar) bar.style.display = '';
            const emailLabel = document.getElementById('currentAccountEmail');
            if (emailLabel) emailLabel.textContent = getUiLanguage() === 'en' ? `${email} (Temp)` : `${email} (临时)`;

            // Update active state on all account cards
            document.querySelectorAll('.account-card').forEach(item => {
                item.classList.remove('active');
                const emailEl = item.querySelector('.account-email');
                if (emailEl && emailEl.textContent.includes(email)) {
                    item.classList.add('active');
                }
            });

            // Update temp-emails independent page header
            const tempName = document.getElementById('tempEmailCurrentName');
            if (tempName) tempName.textContent = email;
            const tempRefreshBtn = document.getElementById('tempEmailRefreshBtn');
            if (tempRefreshBtn) tempRefreshBtn.style.display = '';

            // Hide folder tabs (temp emails don't support folders)
            const folderTabs = document.getElementById('folderTabs');
            if (folderTabs) folderTabs.style.display = 'none';

            // Show loading in message area (prefer temp-emails page container)
            const tempMsgList = document.getElementById('tempEmailMessageList');
            const emailList = document.getElementById('emailList');
            const loadingHTML = `<div class="empty-state"><span class="empty-icon">📬</span><p>${translateAppTextLocal('点击"获取邮件"按钮获取邮件')}</p></div>`;

            if (tempMsgList) tempMsgList.innerHTML = loadingHTML;
            if (emailList) {
                emailList.innerHTML = loadingHTML;
            }

            if (typeof resetEmailDetailState === 'function') {
                resetEmailDetailState({ source: 'temp' });
            }
            if (typeof setTempDetailFocus === 'function') {
                setTempDetailFocus(false);
            }
            if (typeof hideEmailDetailContainer === 'function') {
                hideEmailDetailContainer({ source: 'temp' });
            }
            const count = document.getElementById('emailCount');
            if (count) count.textContent = '';
            const tag = document.getElementById('methodTag');
            if (tag) tag.style.display = 'none';

            // Auto-fetch messages
            loadTempEmailMessages(email);
        }

        // 清空临时邮箱的所有邮件
        async function clearTempEmailMessages(email) {
            if (!confirm(`确定要清空临时邮箱 ${email} 的所有邮件吗？`)) {
                return;
            }

            try {
                const response = await fetch(`/api/temp-emails/${encodeURIComponent(email)}/clear`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    showToast(translateAppTextLocal('邮件已清空'), 'success');

                    // 如果当前选中的就是这个邮箱，清空邮件列表
                    if (currentAccount === email) {
                        currentEmails = [];
                        currentEmailDetail = null;
                        const emailCount = document.getElementById('emailCount');
                        if (emailCount) {
                            emailCount.textContent = '(0)';
                        }
                        const emptyStateHTML = `
                            <div class="empty-state">
                                <span class="empty-icon">📭</span><p>${translateAppTextLocal('收件箱为空')}</p>
                            </div>
                        `;
                        const emailList = document.getElementById('emailList');
                        const tempMessageList = document.getElementById('tempEmailMessageList');
                        if (emailList) emailList.innerHTML = emptyStateHTML;
                        if (tempMessageList) tempMessageList.innerHTML = emptyStateHTML;
                        if (typeof resetEmailDetailState === 'function') {
                            resetEmailDetailState({ source: 'temp' });
                        }
                    }
                } else {
                    handleApiError(data, '清空临时邮箱失败');
                }
            } catch (error) {
                showToast(translateAppTextLocal('清空失败'), 'error');
            }
        }

        // 删除临时邮箱
        async function deleteTempEmail(email) {
            if (!confirm(`确定要删除临时邮箱 ${email} 吗？\n该邮箱的所有邮件也将被删除。`)) {
                return;
            }

            try {
                const response = await fetch(`/api/temp-emails/${encodeURIComponent(email)}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    showToast('临时邮箱已删除', 'success');
                    delete accountsCache['temp'];
                    selectedTempEmailAddresses.delete(email);
                    resetTempEmailDetailIfDeleted(new Set([email]));
                    loadTempEmails(true);
                    // BUG-06: 同 generateTempEmail，不调用 loadGroups()，
                    // 避免 currentGroupId 为 null 时触发 selectGroup() 清空 currentAccount。
                } else {
                    handleApiError(data, '删除临时邮箱失败');
                }
            } catch (error) {
                showToast('删除失败', 'error');
            }
        }

        function confirmBatchDeleteTempEmails() {
            if (selectedTempEmailAddresses.size === 0) {
                showToast(translateAppTextLocal('请先选择要删除的临时邮箱'), 'warning');
                return;
            }

            const count = selectedTempEmailAddresses.size;
            if (!confirm(`确定要删除选中的 ${count} 个临时邮箱吗？\n本地列表与缓存邮件将被删除；若邮箱已在 CF Worker 创建，也会尝试同步删除远端地址。`)) {
                return;
            }

            batchDeleteTempEmails();
        }

        async function batchDeleteTempEmails() {
            const emails = Array.from(selectedTempEmailAddresses);
            const deleteBtn = document.getElementById('tempEmailBatchDeleteBtn');
            const originalText = deleteBtn ? deleteBtn.textContent : '';

            if (deleteBtn) {
                deleteBtn.disabled = true;
                deleteBtn.textContent = translateAppTextLocal(`删除中… (${emails.length})`);
            }

            try {
                const response = await fetch('/api/temp-emails/batch-delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ emails })
                });
                const data = await response.json();

                if (data.success) {
                    showToast(pickApiMessage(data, data.message, 'Batch delete completed'), 'success');
                    const deletedSet = new Set(emails);
                    delete accountsCache['temp'];
                    clearTempEmailSelection();
                    resetTempEmailDetailIfDeleted(deletedSet);
                    loadTempEmails(true);
                    return;
                }

                let message = pickApiMessage(data, data.message || '批量删除失败', data.message_en || 'Batch delete failed');
                const errors = Array.isArray(data.errors) ? data.errors : [];
                if (errors.length > 0) {
                    const first = errors[0] || {};
                    const detail = first.error || first.message || '';
                    if (detail) {
                        message += first.email ? `\n${first.email}：${detail}` : `\n${detail}`;
                    }
                }
                showToast(message, data.deleted_count > 0 ? 'warning' : 'error', data.error || data);

                if ((data.deleted_count || 0) > 0) {
                    delete accountsCache['temp'];
                    clearTempEmailSelection();
                    loadTempEmails(true);
                }
            } catch (error) {
                showToast(translateAppTextLocal('批量删除失败'), 'error');
            } finally {
                if (deleteBtn) {
                    deleteBtn.disabled = false;
                    deleteBtn.textContent = originalText || translateAppTextLocal('删除');
                }
            }
        }

        // 加载临时邮箱的邮件
        async function loadTempEmailMessages(email) {
            const container = document.getElementById('emailList');
            const tempContainer = document.getElementById('tempEmailMessageList');
            const loadingHTML = '<div class="loading-overlay"><span class="spinner"></span></div>';

            // BUG-05: stale request guard
            const requestSeq = ++tempEmailMessagesRequestSeq;
            const targetEmail = String(email || '').trim();

            currentEmailDetail = null;
            if (typeof resetEmailDetailState === 'function') {
                resetEmailDetailState({ source: 'temp' });
            }

            if (container) container.innerHTML = loadingHTML;
            if (tempContainer) tempContainer.innerHTML = loadingHTML;

            // 禁用按钮
            const refreshBtn = document.getElementById('tempEmailRefreshBtn');
            if (refreshBtn) {
                refreshBtn.disabled = true;
                refreshBtn.textContent = translateAppTextLocal('获取中...');
            }

            try {
                const response = await fetch(`/api/temp-emails/${encodeURIComponent(targetEmail)}/messages`);
                const data = await response.json();

                // 丢弃旧请求：用户已切换到其它邮箱或新请求已发起
                if (requestSeq !== tempEmailMessagesRequestSeq || currentAccount !== targetEmail) {
                    return;
                }

                if (data.success) {
                    currentEmails = data.emails;

                    const methodTag = document.getElementById('methodTag');
                    if (methodTag) {
                        methodTag.textContent = 'Temp Mail';
                        methodTag.style.display = 'inline';
                        methodTag.style.backgroundColor = '#00bcf2';
                        methodTag.style.color = 'white';
                    }

                    const emailCount = document.getElementById('emailCount');
                    if (emailCount) emailCount.textContent = `(${data.count})`;

                    // Render to mailbox emailList
                    renderEmailList(data.emails);

                    // Also render to temp-emails page container
                    if (tempContainer) {
                        renderTempEmailMessageList(tempContainer, data.emails);
                    }
                } else {
                    handleApiError(data, '加载临时邮件失败');
                    const errHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>${window.resolveApiErrorMessage ? window.resolveApiErrorMessage(data.error || data, '加载失败', 'Load failed') : (data.error && data.error.message ? data.error.message : '加载失败')}</p></div>`;
                    if (container) container.innerHTML = errHTML;
                    if (tempContainer) tempContainer.innerHTML = errHTML;
                }
            } catch (error) {
                if (requestSeq !== tempEmailMessagesRequestSeq || currentAccount !== targetEmail) {
                    return;
                }
                const errHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><p>网络错误，请重试</p></div>';
                if (container) container.innerHTML = errHTML;
                if (tempContainer) tempContainer.innerHTML = errHTML;
            } finally {
                if (refreshBtn) {
                    // 仅当前最新请求结束时才恢复按钮状态，避免旧请求提前解锁。
                    if (requestSeq === tempEmailMessagesRequestSeq) {
                        refreshBtn.disabled = false;
                        refreshBtn.textContent = translateAppTextLocal('🔄 获取邮件');
                    }
                }
            }
        }

        // 渲染临时邮箱邮件列表到独立页面
        function renderTempEmailMessageList(container, emails) {
            if (!emails || emails.length === 0) {
                container.innerHTML = `<div class="empty-state"><span class="empty-icon">📭</span><p>${translateAppTextLocal('暂无邮件')}</p></div>`;
                return;
            }
            container.innerHTML = emails.map((email, index) => {
                const subject = email.subject || translateAppTextLocal('无主题');
                const from = email.from || translateAppTextLocal('未知发件人');
                const date = email.date || '';
                const preview = (email.body_preview || '').substring(0, 80);
                return `
                    <div class="email-item ${index === 0 ? '' : ''}" onclick="getTempEmailDetail('${escapeJs(email.id || email.message_id || '')}', ${index})">
                        <div class="email-subject">${escapeHtml(subject)}</div>
                        <div class="email-from">${escapeHtml(from)}</div>
                        <div class="email-preview">${escapeHtml(preview)}</div>
                        <div class="email-date">${escapeHtml(date)}</div>
                    </div>
                `;
            }).join('');
        }

        // 获取临时邮件详情
        async function getTempEmailDetail(messageId, index) {
            document.querySelectorAll('#tempEmailMessageList .email-item').forEach((item, i) => {
                item.classList.toggle('active', i === index);
            });

            if (typeof showEmailDetailContainer === 'function') {
                showEmailDetailContainer({ source: 'temp' });
            }
            if (typeof setTempDetailFocus === 'function') {
                setTempDetailFocus(true);
            }
            if (typeof setEmailDetailToolbarVisibility === 'function') {
                setEmailDetailToolbarVisibility(true, { source: 'temp' });
            }

            const refs = typeof getEmailDetailRefs === 'function'
                ? getEmailDetailRefs({ source: 'temp' })
                : {
                    container: document.getElementById('tempEmailDetail'),
                    toolbar: document.getElementById('tempEmailDetailToolbar')
                };
            const container = refs.container;
            if (container) {
                container.innerHTML = '<div class="loading-overlay"><span class="spinner"></span></div>';
            }

            // BUG-05: stale request guard
            const requestSeq = ++tempEmailDetailRequestSeq;
            const mailboxEmail = String(currentAccount || '').trim();

            try {
                const response = await fetch(`/api/temp-emails/${encodeURIComponent(mailboxEmail)}/messages/${encodeURIComponent(messageId)}`);
                const data = await response.json();

                // 丢弃旧请求：用户已切换到其它邮箱或新详情请求已发起
                if (requestSeq !== tempEmailDetailRequestSeq || String(currentAccount || '').trim() !== mailboxEmail) {
                    return;
                }

                if (data.success) {
                    currentEmailDetail = data.email;
                    renderEmailDetail(data.email, { source: 'temp' });
                } else {
                    handleApiError(data, '加载邮件详情失败');
                    if (container) {
                        container.innerHTML = `
                            <div class="empty-state">
                                <span class="empty-icon">⚠️</span><p>${window.resolveApiErrorMessage ? window.resolveApiErrorMessage(data.error || data, '加载失败', 'Load failed') : (data.error && data.error.message ? data.error.message : '加载失败')}</p>
                            </div>
                        `;
                    }
                }
            } catch (error) {
                if (requestSeq !== tempEmailDetailRequestSeq || String(currentAccount || '').trim() !== mailboxEmail) {
                    return;
                }
                if (container) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <span class="empty-icon">⚠️</span><p>网络错误，请重试</p>
                        </div>
                    `;
                }
            }
        }

