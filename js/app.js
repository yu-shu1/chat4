document.addEventListener('DOMContentLoaded', async () => {
    const loaderBar = document.getElementById('loader-tech-bar');
    const welcomeSubtitle = document.querySelector('.welcome-subtitle-scramble');
    const welcomeScreen = document.getElementById('welcome-animation');
    const disclaimerModal = document.getElementById('disclaimer-modal');
    const acceptDisclaimerBtn = document.getElementById('accept-disclaimer');

    const updateLoader = (text, width) => {
        if (welcomeSubtitle) welcomeSubtitle.textContent = text;
        if (loaderBar) loaderBar.style.width = width;
    };

    const hideWelcomeScreen = () => {
        if (!welcomeScreen) return;
        welcomeScreen.classList.add('hidden');
        setTimeout(() => {
            welcomeScreen.style.display = 'none';
        }, 800);
    };

    const safeAwait = async (promise, fallback = null) => {
        try {
            return await promise;
        } catch (error) {
            console.error('操作失败:', error);
            return fallback;
        }
    };

    try {
        try { setupEventListeners?.(); } catch(e) { console.error('setupEventListeners:', e); }

        if (typeof localforage === 'undefined') {
            console.warn('LocalForage 未加载，将使用 localStorage 降级方案');
        }

        try {
            const emergencyBackupRaw = localStorage.getItem('BACKUP_V1_critical');
            if (emergencyBackupRaw) {
                const emergencyBackup = JSON.parse(emergencyBackupRaw);
                if (emergencyBackup && Array.isArray(emergencyBackup.messages) && emergencyBackup.messages.length > 0) {
                    console.warn('[boot] 检测到紧急备份，可用于异常恢复');
                }
            }
        } catch (e) {
            console.warn('[boot] 紧急备份检查失败:', e);
        }

        updateLoader('正在建立安全连接...', '10%');
        await safeAwait(initializeSession());

        updateLoader('正在读取记忆存档...', '40%');
        await safeAwait(loadData());

        updateLoader('正在渲染我们的世界...', '70%');
        
        await Promise.allSettled([
            safeAwait(initializeRandomUI?.()),
        ]);

        setInterval(checkStatusChange, 60000);

        updateLoader('连接成功，欢迎回来。', '100%');
        setTimeout(() => {
            hideWelcomeScreen();
            // 注意：这里不再直接调用 showHomeScreen，
            // 因为公告弹窗会在 load 事件后显示，会覆盖桌面。
            // 我们将 showHomeScreen 的调用移到公告弹窗关闭逻辑中。
            // 如果公告弹窗未显示（比如已弹过），则直接显示桌面。
            // 为了安全，我们延时检查公告状态，如果公告没有显示，则直接显示桌面。
            setTimeout(() => {
                const modal = document.getElementById('daily-greeting-modal');
                const isModalHidden = modal ? modal.classList.contains('hidden') : true;
                if (isModalHidden || modal.style.display === 'none') {
                    // 公告没有显示，直接显示桌面
                    showHomeScreen();
                } else {
                    // 公告正在显示，设置待激活标志
                    const homeScreen = document.getElementById('home-screen');
                    if (homeScreen) homeScreen._pendingActivation = true;
                }
            }, 500);
        }, 3500);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                try {
                    if (typeof saveTimeout !== 'undefined') clearTimeout(saveTimeout);
                } catch (e) {}
                try { _backupCriticalData(); } catch (e) { console.warn('[visibilitychange] 紧急备份失败:', e); }
                try {
                    const p = saveData();
                    if (p && typeof p.catch === 'function') {
                        p.catch(e => console.error('[visibilitychange] 保存失败:', e));
                    }
                } catch (e) {
                    console.error('[visibilitychange] 保存失败:', e);
                }
            } else if (document.visibilityState === 'visible') {
                try {
                    const backup = typeof _tryRecoverFromBackup === 'function' ? _tryRecoverFromBackup() : null;
                    if (backup && Array.isArray(backup.messages) && backup.messages.length > 0 && Array.isArray(messages) && backup.messages.length > messages.length) {
                        console.warn('[visibilitychange] 检测到备份消息比当前更多，自动尝试恢复');
                        try {
                            messages = backup.messages.map(m => ({
                                ...m,
                                timestamp: new Date(m.timestamp)
                            }));
                            if (backup.settings) Object.assign(settings, backup.settings);
                            if (typeof updateUI === 'function') updateUI();
                            if (typeof throttledSaveData === 'function') throttledSaveData();
                            showNotification('已自动恢复本地临时备份内容', 'warning', 3500);
                        } catch (restoreErr) {
                            console.warn('[visibilitychange] 自动恢复失败，保留当前页面内容:', restoreErr);
                        }
                    }
                } catch (e) {
                    console.warn('[visibilitychange] 恢复备份失败:', e);
                }
            }
        });

        window.addEventListener('pagehide', () => {
            try { _backupCriticalData(); } catch (e) {}
        });

        window.addEventListener('beforeunload', () => {
            try { _backupCriticalData(); } catch (e) {}
        });

        setInterval(() => {
            saveData().catch(e => console.warn('[autoBackup] 定时保存失败:', e));
        }, 3 * 60 * 1000);

        (() => {
            const REMIND_KEY = 'exportReminderLastShown';
            const last = parseInt(localStorage.getItem(REMIND_KEY) || '0', 10);
            const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);
            if (daysSince >= 7) {
                setTimeout(() => {
                    showNotification('建议定期导出备份，防止数据意外丢失', 'info', 7000);
                    localStorage.setItem(REMIND_KEY, String(Date.now()));
                }, 8000);
            }
        })();

        setTimeout(async () => {
            if ('Notification' in window && Notification.permission === 'default') {
                try {
                    const permission = await Notification.requestPermission();
                    if (permission === 'granted') {
                        showNotification('已开启系统通知，收到消息时会提醒你', 'success', 3000);
                    }
                } catch(e) {
                    console.warn('通知权限请求失败:', e);
                }
            }
        }, 3000);

    } catch (err) {
        console.error('严重初始化错误:', err);
        try {
            const backup = typeof _tryRecoverFromBackup === 'function' ? _tryRecoverFromBackup() : null;
            if (backup && Array.isArray(backup.messages) && backup.messages.length > 0) {
                messages = backup.messages.map(m => ({
                    ...m,
                    timestamp: new Date(m.timestamp)
                }));
                if (backup.settings) Object.assign(settings, backup.settings);
                if (typeof updateUI === 'function') updateUI();
                showNotification('初始化异常，已使用本地紧急备份恢复', 'warning', 5000);
            }
        } catch (recoverErr) {
            console.warn('[boot] 初始化失败后的恢复也失败:', recoverErr);
        }
        updateLoader('加载遇到问题，已强制进入...', '100%');
        setTimeout(hideWelcomeScreen, 3500);
    }
    
    // 确保所有开关在页面完全加载后同步
    setTimeout(() => {
        if (typeof updateUI === 'function') updateUI();
    }, 1500);
    
});

// 原有 sticker 相关代码保持不变
const stickerInput = document.getElementById('sticker-file-input');
if (stickerInput) {
    // ... (保持不变)
}

const myStickerQuickUpload = document.getElementById('my-sticker-quick-upload');
if (myStickerQuickUpload) {
    // ... (保持不变)
}

// ========== 修改 window.addEventListener('load') 部分 ==========
// 覆盖原来的 load 监听，在公告显示时设置桌面待激活
window.addEventListener('load', function() {
    setTimeout(function() {
        try {
            // 清除“今日已弹”记录，确保每次刷新都弹出（必须）
            localStorage.removeItem('dailyGreetingShown');

            // 检查并记录对方心情（原有功能，不影响弹出）
            try { if (typeof checkPartnerDailyMood === 'function') checkPartnerDailyMood(); } catch(e2) { console.warn('checkPartnerDailyMood error:', e2); }
            
            // 构建公告内容（基于当天数据）
            if (typeof _buildDailyGreeting === 'function') _buildDailyGreeting();
            
            // 强制弹出公告（移除隐藏类、确保显示）
            var modal = document.getElementById('daily-greeting-modal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.style.display = 'flex';
                modal.style.opacity = '1';
                
                // --- 关键修改：公告显示时，桌面不应激活，设置待激活标志 ---
                const homeScreen = document.getElementById('home-screen');
                if (homeScreen) {
                    homeScreen._pendingActivation = true;
                    // 确保桌面处于非激活状态
                    homeScreen.classList.remove('active');
                }
                // --- 修改结束 ---
            }
        } catch(e) { 
            console.warn('Daily greeting timing error:', e); 
        }
    }, 1000);
});

// =============================================
// 新增：桌面层逻辑
// =============================================
// 新增辅助：获取每日寄语文本（不包含标签）
function getDailyNote() {
    try {
        const customData = JSON.parse(localStorage.getItem('dg_custom_data') || '{}');
        if (customData.notes && customData.notes.length > 0) {
            const now = new Date();
            const seed = now.getFullYear() * 10000 + (now.getMonth()+1) * 100 + now.getDate();
            const idx = Math.floor(Math.abs(Math.sin((seed + 1) * 9301 + 49297) * 233280) % 233280 / 233280 * customData.notes.length);
            return customData.notes[idx];
        }
    } catch (e) {}
    return '今天也要元气满满，我在这里陪着你 ✦';
}

/**
 * 更新横幅上的问候语（包含双方头像+昵称，底部显示日期与每日寄语）
 */
function updateBannerGreeting() {
    const bannerEl = document.getElementById('banner-greeting');
    if (!bannerEl) return;

    const now = new Date();
    const partnerName = settings?.partnerName || '梦角';
    const myName = settings?.myName || '我';

    // 获取公告数据（仅用于节日）
    const dgData = _getDailyGreetingData();
    const festival = dgData.festival;

    // 获取每日寄语
    const dailyNote = getDailyNote();

    // 双方头像
    const partnerImg = document.querySelector('#partner-avatar img')?.src || '';
    const myImg = document.querySelector('#my-avatar img')?.src || '';

    // 节日 emoji（若没有则用 ✦）
    const festEmoji = festival ? festival.emoji : '✦';
    const festName = festival ? festival.name + '快乐' : '今天也要开心哦';
    const festLabel = festival ? festival.label : '✦ 每日寄语 ✦';

    bannerEl.innerHTML = `
        <div style="display:flex; align-items:flex-start; justify-content:space-between; width:100%;">
            <!-- 左侧：对方头像 + 昵称 -->
            <div style="display:flex; flex-direction:column; align-items:center; gap:4px; flex:1;">
                <div style="width:44px; height:44px; border-radius:50%; overflow:hidden; background:var(--border-color); border:2.5px solid var(--accent-color); flex-shrink:0;">
                    ${partnerImg ? `<img src="${partnerImg}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fas fa-user" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--text-secondary);font-size:18px;"></i>`}
                </div>
                <span style="font-size:11px; font-weight:600; color:var(--text-primary); letter-spacing:0.3px;">${partnerName}</span>
            </div>

            <!-- 中间：节日/问候语（无时间戳） -->
            <div style="display:flex; flex-direction:column; align-items:center; gap:2px; flex:1.5;">
                <span style="font-size:28px; line-height:1;">${festEmoji}</span>
                <span style="font-size:16px; font-weight:700; color:var(--accent-color); letter-spacing:1px;">
                    ${festName}
                </span>
                <span style="font-size:9px; color:var(--text-secondary); opacity:0.5; letter-spacing:2px; text-transform:uppercase;">
                    ${festLabel}
                </span>
            </div>

            <!-- 右侧：我的头像 + 昵称 -->
            <div style="display:flex; flex-direction:column; align-items:center; gap:4px; flex:1;">
                <div style="width:44px; height:44px; border-radius:50%; overflow:hidden; background:var(--border-color); border:2.5px solid var(--border-color); flex-shrink:0;">
                    ${myImg ? `<img src="${myImg}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fas fa-user" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--text-secondary);font-size:18px;"></i>`}
                </div>
                <span style="font-size:11px; font-weight:600; color:var(--text-primary); letter-spacing:0.3px;">${myName}</span>
            </div>
        </div>
        <!-- 每日寄语（位于日期上方，不显示“每日寄语”标签） -->
        <div style="font-size:10px; color:var(--text-secondary); opacity:0.6; margin-top:4px; font-style:italic; letter-spacing:0.5px;">
            “${dailyNote}”
        </div>
        <div style="font-size:9px; color:var(--text-secondary); opacity:0.3; margin-top:2px; letter-spacing:2px;">
            ${now.getFullYear()} · ${now.getMonth()+1}月${now.getDate()}日
        </div>
    `;
}

/**
 * 填充桌面中间空白区域（仅显示心情、天气、状态、装饰图）
 */
function populateHomeSpacer() {
    const spacer = document.getElementById('home-spacer');
    if (!spacer) {
        console.warn('[populateHomeSpacer] #home-spacer 元素不存在');
        return;
    }

    try {
        const now = new Date();
        const partnerName = settings?.partnerName || '梦角';
        const myName = settings?.myName || '我';

        // 获取公告数据（仅用于天气/状态，无需节日）
        let dgData = { weather: '晴', status: '一切都好' };
        try {
            if (typeof _getDailyGreetingData === 'function') {
                dgData = _getDailyGreetingData();
            }
        } catch (e) { /* ignore */ }

        const weather = dgData.weather || '晴';
        const status = dgData.status || '一切都好';

        // 获取双方心情数据
        let partnerMoodObj = null;
        let myMoodObj = null;
        let todayMood = {};
        try {
            const todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
            const moodDataRaw = window.moodData || {};
            todayMood = moodDataRaw[todayStr] || {};
            if (typeof getAllMoodOptions === 'function') {
                const allMoods = getAllMoodOptions();
                partnerMoodObj = todayMood.partner ? allMoods.find(m => m.key === todayMood.partner) : null;
                myMoodObj = todayMood.user ? allMoods.find(m => m.key === todayMood.user) : null;
            }
        } catch (e) { /* ignore */ }

        // 获取装饰图
        let decoImg = '';
        try {
            const customData = JSON.parse(localStorage.getItem('dg_custom_data') || '{}');
            decoImg = customData.decoImg || '';
        } catch (e) { /* ignore */ }

        spacer.style.cssText = `
            flex: 2;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 0 24px 8px;
            overflow: hidden;
            min-height: 0;
        `;

        spacer.innerHTML = `
            <!-- 双方心情 -->
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; max-width:360px; margin:0 auto; width:100%;">
                <div style="background:rgba(var(--accent-color-rgb),0.06); border-radius:12px; padding:8px 10px; border:1px solid rgba(var(--accent-color-rgb),0.1); text-align:center;">
                    <div style="font-size:9px; color:var(--text-secondary); opacity:0.4; letter-spacing:1px; text-transform:uppercase;">${myName}</div>
                    <div style="font-size:22px; margin:1px 0;">${myMoodObj ? myMoodObj.kaomoji : '😊'}</div>
                    <div style="font-size:11px; font-weight:600; color:var(--text-primary);">${myMoodObj ? myMoodObj.label : '心情不错'}</div>
                    ${todayMood.note ? `<div style="font-size:9px; color:var(--text-secondary); margin-top:1px; opacity:0.5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${todayMood.note}</div>` : ''}
                </div>
                <div style="background:rgba(var(--accent-color-rgb),0.06); border-radius:12px; padding:8px 10px; border:1px solid rgba(var(--accent-color-rgb),0.1); text-align:center;">
                    <div style="font-size:9px; color:var(--text-secondary); opacity:0.4; letter-spacing:1px; text-transform:uppercase;">${partnerName}</div>
                    <div style="font-size:22px; margin:1px 0;">${partnerMoodObj ? partnerMoodObj.kaomoji : '💭'}</div>
                    <div style="font-size:11px; font-weight:600; color:var(--text-primary);">${partnerMoodObj ? partnerMoodObj.label : '未记录'}</div>
                    ${todayMood.partnerNote ? `<div style="font-size:9px; color:var(--text-secondary); margin-top:1px; opacity:0.5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${todayMood.partnerNote}</div>` : ''}
                </div>
            </div>

            ${decoImg ? `<div style="max-width:360px; margin:8px auto 0; border-radius:10px; overflow:hidden; max-height:50px;"><img src="${decoImg}" style="width:100%; height:100%; object-fit:cover; border-radius:10px;" onerror="this.style.display='none'"></div>` : ''}

            <div style="max-width:360px; margin:6px auto 0; display:flex; justify-content:center; gap:14px; font-size:9px; color:var(--text-secondary); opacity:0.3; letter-spacing:1px;">
                <span>🌤 ${weather}</span>
                <span>✦ ${status}</span>
            </div>
        `;

        console.log('[populateHomeSpacer] 中间区域已填充（不含节日和每日寄语）');
    } catch (error) {
        console.error('[populateHomeSpacer] 渲染失败:', error);
        spacer.innerHTML = `
            <div style="text-align:center; color:var(--text-secondary); opacity:0.4; padding:20px;">
                <div style="font-size:28px; margin-bottom:8px;">💫</div>
                <div style="font-size:14px;">今天也要开心哦</div>
            </div>
        `;
    }
}


/**
 * 显示桌面并初始化网格
 */
function showHomeScreen() {
    const homeScreen = document.getElementById('home-screen');
    if (!homeScreen) return;

    homeScreen.style.display = 'flex';

    const modal = document.getElementById('daily-greeting-modal');
    const isModalVisible = modal && !modal.classList.contains('hidden') && modal.style.display !== 'none';
    if (isModalVisible) {
        homeScreen._pendingActivation = true;
        return;
    }

    updateBannerGreeting();
    populateHomeSpacer();  // 新增：填充中间空白区域
    initHomeGrid();
    homeScreen.classList.add('active');
    homeScreen._pendingActivation = false;
}




/**
 * 初始化功能网格
 */
function initHomeGrid() {
    const container = document.getElementById('home-grid-container');
    if (!container) return;

    const allApps = [
        { id: 'chat', icon: 'fa-comment-dots', label: '对话', action: 'chat' },
        { id: 'mood', icon: 'fa-calendar-day', label: '心晴手账', action: 'mood' },
        { id: 'envelope', icon: 'fa-envelope', label: '留言板', action: 'envelope' },
        { id: 'stats', icon: 'fa-chart-bar', label: '消息统计', action: 'stats' },
        { id: 'fortune', icon: 'fa-star-and-crescent', label: '运势·占卜', action: 'fortune' },
        { id: 'anniversary', icon: 'fa-heart', label: '重要日', action: 'anniversary' },
        { id: 'customReplies', icon: 'fa-comment-dots', label: '字卡库', action: 'customReplies' },
        { id: 'decision', icon: 'fa-balance-scale', label: '抉择', action: 'decision' },
        { id: 'appearance', icon: 'fa-palette', label: '外观', action: 'appearance' },
        { id: 'chatSettings', icon: 'fa-sliders-h', label: '聊天设置', action: 'chatSettings' },
        { id: 'data', icon: 'fa-database', label: '数据管理', action: 'data' },
    ];

    const mainApps = allApps.slice(0, 8);
    const settingsApps = allApps.slice(8);

    container.innerHTML = '';

    // 1️⃣ 主功能网格（占满整行）
    const mainGrid = document.createElement('div');
    mainGrid.style.cssText = `
        grid-column: 1 / -1;          /* ★ 关键：占满全部4列 */
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 16px;
    `;
    mainApps.forEach(app => {
        const btn = createAppButton(app);
        mainGrid.appendChild(btn);
    });
    container.appendChild(mainGrid);

    // 2️⃣ 设置功能组（单独框起来，占一整行）
    const settingsGroup = document.createElement('div');
    settingsGroup.style.cssText = `
        grid-column: 1 / -1;
        background: var(--primary-bg);
        border: 1.5px solid var(--border-color);
        border-radius: var(--radius);
        padding: 12px 0;        /* 左右无内边距，与主网格对齐 */
        box-shadow: 0 2px 8px rgba(0,0,0,0.03);
    `;
    
    // 设置行使用 flex，按钮宽度固定为列宽，均匀分布
    const settingsRow = document.createElement('div');
    settingsRow.style.cssText = `
        display: flex;
        justify-content: space-evenly;
        align-items: center;
        width: 100%;
    `;
    
    // 计算列宽：与主网格的列宽完全相同（4列，gap 12px）
    const colWidth = `calc((100% - 3 * 12px) / 4)`;
    
    settingsApps.forEach(app => {
        const btn = createAppButton(app);
        btn.style.flex = `0 0 ${colWidth}`;   // 固定宽度，不拉伸
        settingsRow.appendChild(btn);
    });
    
    settingsGroup.appendChild(settingsRow);
    container.appendChild(settingsGroup);
}

// 辅助函数：创建单个按钮（保持不变）
function createAppButton(app) {
    const btn = document.createElement('div');
    btn.className = 'home-app-icon';
    btn.dataset.action = app.action;
    btn.innerHTML = `
        <i class="fas ${app.icon} app-icon"></i>
        <span class="app-label">${app.label}</span>
    `;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleHomeAction(app.action);
    });
    return btn;
}


/**
 * 处理桌面功能点击
 */
function handleHomeAction(action) {
    const homeScreen = document.getElementById('home-screen');

    // 辅助函数：安全显示模态框
    function safeShowModal(modalId, contentFn, delay = 150) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            console.warn(`[桌面] 未找到模态框 #${modalId}`);
            return;
        }
    
        // ★ 关键：移除可能残留的 hidden 类
        modal.classList.remove('hidden');
        
        // 清除可能的隐藏计时器（防止 hideModal 残留）
        if (modal._hideTimeout) {
            clearTimeout(modal._hideTimeout);
            modal._hideTimeout = null;
        }
    
        // 直接显示模态框（不依赖外部 showModal）
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';
    
        // 触发内容入场动画
        requestAnimationFrame(() => {
            const content = modal.querySelector('.modal-content');
            if (content) {
                content.style.opacity = '1';
                content.style.transform = 'translateY(0) scale(1)';
            }
        });
    
        // 执行内容填充（若提供）
        if (typeof contentFn === 'function') {
            setTimeout(() => {
                try {
                    contentFn();
                } catch (e) {
                    console.error(`[桌面] 填充 ${modalId} 内容失败:`, e);
                }
            }, delay);
        }
    }

    switch (action) {
        case 'chat':
            if (homeScreen) homeScreen.classList.remove('active');
            const chatContainer = document.getElementById('chat-container');
            if (chatContainer) {
                setTimeout(() => {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }, 100);
            }
            break;

        case 'mood':
            safeShowModal('mood-modal', renderMoodCalendar);
            break;

        case 'envelope':
            safeShowModal('envelope-board-modal', renderEnvelopeBoard);
            break;

        case 'stats':
            safeShowModal('stats-modal', renderStatsContent);
            break;

        case 'fortune':
            safeShowModal('fortune-lenormand-modal', () => {
                generateFortune();
                switchFLTab('fortune');
            });
            break;

        case 'anniversary':
            safeShowModal('anniversary-modal', renderAnniversariesList);
            break;

        case 'settings':
            safeShowModal('settings-modal');
            break;

        case 'appearance':
            safeShowModal('appearance-modal', () => {
                if (typeof hideAppearancePanel === 'function') hideAppearancePanel();
                if (typeof renderBackgroundGallery === 'function') renderBackgroundGallery();
                if (typeof renderThemeSchemesList === 'function') renderThemeSchemesList();
            });
            break;

        case 'customReplies':
            safeShowModal('custom-replies-modal', () => {
                currentMajorTab = 'reply';
                currentSubTab = 'custom';
                if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
            });
            break;

        default:
            console.warn('未知的桌面操作:', action);
            break;
    }
}


// =============================================
// 覆盖 closeDailyGreeting 函数，在关闭公告时激活桌面
// =============================================
// 保存原始函数引用（如果存在）
const _origCloseDailyGreeting = window.closeDailyGreeting;


window.closeDailyGreeting = function() {
    try {
        var modal = document.getElementById('daily-greeting-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.style.display = 'none';
            modal.style.opacity = '';
        }
        // --- 关键修改：关闭公告后，检查桌面待激活状态并激活 ---
        const homeScreen = document.getElementById('home-screen');
        if (homeScreen && homeScreen._pendingActivation) {
            homeScreen._pendingActivation = false;
            // ★★★ 添加下面这一行，强制覆盖内联 display:none ★★★
            homeScreen.style.display = 'flex';

            // 重新初始化桌面内容
            if (typeof updateBannerGreeting === 'function') updateBannerGreeting();
            if (typeof initHomeGrid === 'function') initHomeGrid();
            homeScreen.classList.add('active');
        }
        // --- 修改结束 ---
    } catch(e) {
        console.warn('关闭公告失败:', e);
    }
    // 如果原始函数存在，也调用它（防止覆盖其他逻辑）
    if (typeof _origCloseDailyGreeting === 'function' && _origCloseDailyGreeting !== window.closeDailyGreeting) {
        _origCloseDailyGreeting();
    }
};

// 暴露全局函数
window.showHomeScreen = showHomeScreen;
window.handleHomeAction = handleHomeAction;
window.initHomeGrid = initHomeGrid;
window.updateBannerGreeting = updateBannerGreeting;
window.populateHomeSpacer = populateHomeSpacer;
