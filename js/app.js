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
function updateBannerGreeting() {
    const bannerEl = document.getElementById('banner-greeting');
    if (!bannerEl) return;

    const now = new Date();
    const hour = now.getHours();

    // ---- 1. 我的时间（实时） ----
    const myTimeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    // ---- 2. 对方时间（按间隔更新，带随机流速） ----
    if (!settings.partnerTimeRef) {
        settings.partnerTimeRef = Date.now();
    }
    if (!settings.partnerTime) {
        const initH = Math.floor(Math.random() * 24);
        const initM = Math.floor(Math.random() * 60);
        const initDate = new Date();
        initDate.setHours(initH, initM, 0, 0);
        settings.partnerTime = initDate.getTime();
    }
    if (!settings.partnerSpeedFactor) {
        settings.partnerSpeedFactor = 1;
    }
    if (!settings.partnerNextInterval) {
        settings.partnerNextInterval = (6 + Math.random() * 20) * 3600000;
    }

    const nowReal = Date.now();
    const elapsedReal = nowReal - settings.partnerTimeRef;
    let displayTime;
    let needSave = false;

    if (elapsedReal >= settings.partnerNextInterval) {
        const newH = Math.floor(Math.random() * 24);
        const newM = Math.floor(Math.random() * 60);
        const newDate = new Date();
        newDate.setHours(newH, newM, 0, 0);
        settings.partnerTime = newDate.getTime();
        settings.partnerTimeRef = nowReal;
        if (Math.random() < 0.01) {
            settings.partnerSpeedFactor = 0.75 + Math.random() * 0.5;
        } else {
            settings.partnerSpeedFactor = 1;
        }
        settings.partnerNextInterval = (6 + Math.random() * 20) * 3600000;
        needSave = true;
        displayTime = settings.partnerTime;
    } else {
        const offset = elapsedReal * settings.partnerSpeedFactor;
        displayTime = settings.partnerTime + offset;
    }

    if (needSave) throttledSaveData();

    const displayDate = new Date(displayTime);
    const partnerTimeStr = displayDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    // ---- 3. 原有的节庆、标题、格言数据 ----
    let data = {};
    if (typeof _getDailyGreetingData === 'function') {
        data = _getDailyGreetingData();
    }
    const festival = data.festival;

    let englishLabel = 'GOOD EVENING';
    if (hour < 6) englishLabel = 'GOOD NIGHT';
    else if (hour < 12) englishLabel = 'GOOD MORNING';
    else if (hour < 18) englishLabel = 'GOOD AFTERNOON';
    if (festival?.label) englishLabel = festival.label;

    let customData = {};
    try { customData = JSON.parse(localStorage.getItem('dg_custom_data') || '{}'); } catch(e) {}
    let titles = customData.titles || [];
    let notes = customData.notes || [];
    if (titles.length === 0) titles = ['早上好', '今天也要开心哦', '你在我心里呀', '想你'];
    if (notes.length === 0) notes = ['今天也要元气满满，我在这里陪着你 ✦', '每一天都因为有你而特别 ✦', '想到你就觉得很安心 ✦', '你是我最喜欢的人 ✦'];

    const dailySeed = now.getFullYear() * 10000 + (now.getMonth()+1) * 100 + now.getDate();
    function seededRandom(seed) { return (Math.abs(Math.sin(seed * 9301 + 49297) * 233280) % 233280) / 233280; }
    const titleIndex = Math.floor(seededRandom(dailySeed) * titles.length);
    const noteIndex = Math.floor(seededRandom(dailySeed + 1) * notes.length);
    const selectedTitle = titles[titleIndex] || '早上好';
    const selectedNote = notes[noteIndex] || '今天也要元气满满 ✦';

    const partnerAvatar = DOMElements?.partner?.avatar?.querySelector('img')?.src || '';
    const myAvatar = DOMElements?.me?.avatar?.querySelector('img')?.src || '';
    const partnerName = settings?.partnerName || '梦角';
    const myName = settings?.myName || '我';

    // ---- 4. 构建头像 + 名字 + 时间的 HTML（增加点击换头像） ----
    const avatarHtml = (src, name, timeStr, isMe) => `
        <div style="display:flex; flex-direction:column; align-items:center; cursor:pointer;" onclick="window._openAvatarModal && window._openAvatarModal(${isMe})">
            <div style="width:48px; height:48px; border-radius:50%; overflow:hidden; background:var(--border-color); border:2px solid var(--accent-color);">
                ${src ? `<img src="${src}" style="width:100%; height:100%; object-fit:cover;">` : `<i class="fas fa-user" style="font-size:22px; color:var(--text-secondary); line-height:48px;"></i>`}
            </div>
            <span style="font-size:11px; margin-top:3px; font-weight:500; color:var(--text-primary);">${name}</span>
            <span style="font-size:10px; color:var(--text-secondary); margin-top:1px;">${timeStr}</span>
        </div>
    `;

    // 节庆表情
    let emojiHtml = '';
    if (festival?.emoji) {
        emojiHtml = `<span style="display:inline-block; animation: floatEmoji 3.6s ease-in-out infinite; font-size:20px;">${festival.emoji}</span>`;
    } else {
        emojiHtml = `<span style="display:inline-block; animation: floatEmoji 3.6s ease-in-out infinite; width:22px; height:22px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" stroke-width="1.8" style="width:100%; height:100%;">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                <line x1="9" y1="9" x2="9.01" y2="9"/>
                <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
        </span>`;
    }

    // ---- 时间戳（仅年月日） ----
    const currentTimeStr = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // ---- 5. 填充 banner 内容（问候语左对齐，时间戳右对齐，增加左右间距） ----
    bannerEl.innerHTML = `
        <div style="width:100%; display:flex; flex-direction:column; align-items:center; gap:2px; max-width:100%; overflow:hidden;">
            <!-- 英文标签 + 时间戳（flex 行，左右对齐，增加左右内边距至 16px） -->
            <div style="width:100%; display:flex; justify-content:space-between; align-items:center; padding:0 16px; font-size:9px; color:var(--text-secondary); letter-spacing:2px; opacity:0.65; font-family:monospace; margin-bottom:1px;">
                <span>${englishLabel}</span>
                <span>${currentTimeStr}</span>
            </div>

            <div style="display:flex; gap:24px; margin:2px 0 4px;">
                ${avatarHtml(myAvatar, myName, myTimeStr, true)}
                ${avatarHtml(partnerAvatar, partnerName, partnerTimeStr, false)}
            </div>

            <div style="font-size:17px; font-weight:700; color:var(--text-primary); letter-spacing:0.5px; display:flex; align-items:center; gap:6px; margin-top:2px;">
                ${emojiHtml}
                <span>${selectedTitle}</span>
            </div>

            <div style="font-size:12px; color:var(--text-secondary); max-width:92%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:center; font-style:italic; margin-top:1px;" title="${selectedNote}">
                ${selectedNote}
            </div>
        </div>
    `;
}


/**
 * 显示桌面并初始化网格
 * 如果公告弹窗正在显示，则只设置待激活标志，不实际激活
 */
function showHomeScreen() {
    const homeScreen = document.getElementById('home-screen');
    if (!homeScreen) return;

    // 覆盖内联 display:none
    homeScreen.style.display = 'flex';

    const modal = document.getElementById('daily-greeting-modal');
    const isModalVisible = modal && !modal.classList.contains('hidden') && modal.style.display !== 'none';
    if (isModalVisible) {
        homeScreen._pendingActivation = true;
        return;
    }

    updateBannerGreeting();
    initHomeGrid();
    updateHomeSpacer();
    homeScreen.classList.add('active');
    homeScreen._pendingActivation = false;

    // ----- 启动定时器（每分钟刷新一次时间） -----
    if (homeBannerTimer) clearInterval(homeBannerTimer);
    homeBannerTimer = setInterval(() => {
        if (homeScreen.classList.contains('active')) {
            updateBannerGreeting();
        }
    }, 60000);
}








/**
 * 更新桌面中间的公告栏剩余内容（天气、状态、心情）
 * 去除时间戳和每日寄语，完整显示心情备注
 */
 function updateHomeSpacer() {
    const container = document.getElementById('home-spacer-content');
    if (!container) return;

    const now = new Date();
    const dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    const data = _getDailyGreetingData();
    const weather = data.weather;
    const status = data.status;
    const partnerName = settings?.partnerName || '梦角';

    // ---- 获取今日心情 ----
    let partnerMood = null;
    let partnerNote = '';
    const moodData = window.moodData || {};
    const todayMood = moodData[dateStr];
    if (todayMood && todayMood.partner) {
        const allMoods = getAllMoodOptions();
        const moodObj = allMoods.find(m => m.key === todayMood.partner);
        if (moodObj) {
            partnerMood = { kaomoji: moodObj.kaomoji, label: moodObj.label };
            partnerNote = todayMood.partnerNote || '';
        }
    }

    // ---- 构建卡片 HTML ----
    container.innerHTML = `
        <div class="home-spacer-card" style="
            background: rgba(var(--accent-color-rgb), 0.08);
            border: 1px solid rgba(var(--accent-color-rgb), 0.2);
            border-radius: var(--radius);
            padding: 14px 16px;
            margin: 0 12px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.06);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            width: 100%;
            max-width: 400px;
            box-sizing: border-box;
        ">
            <!-- 标题行 · 梦角 今天状态 · + 装饰线 -->
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <div style="font-size: 13px; font-weight: 600; color: var(--accent-color); letter-spacing: 0.5px; white-space: nowrap;">
                    · ${partnerName} 今天状态 ·
                </div>
                <div style="flex: 1; height: 1px; background: linear-gradient(90deg, var(--accent-color), transparent);"></div>
            </div>

            <!-- 状态 + 天气 -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                <div style="background: var(--primary-bg); border-radius: 10px; padding: 8px 10px; text-align: center;">
                    <div style="font-size: 11px; color: var(--text-secondary);">状态</div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${status || '—'}</div>
                </div>
                <div style="background: var(--primary-bg); border-radius: 10px; padding: 8px 10px; text-align: center;">
                    <div style="font-size: 11px; color: var(--text-secondary);">天气</div>
                    <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${weather || '—'}</div>
                </div>
            </div>

            <!-- 心情 + 完整备注 -->
            ${partnerMood ? `
            <div style="background: var(--primary-bg); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 20px;">${partnerMood.kaomoji}</span>
                    <span style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${partnerMood.label}</span>
                </div>
                ${partnerNote ? `<div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; word-break: break-word; padding-left: 4px;">${partnerNote}</div>` : ''}
            </div>
            ` : `
            <div style="background: var(--primary-bg); border-radius: 10px; padding: 10px 12px; text-align: center; color: var(--text-secondary); font-size: 13px;">
                ${partnerName} 今天还没有留下心情记录
            </div>
            `}
        </div>
    `;
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
// app.js — 完整的 handleHomeAction 函数
function handleHomeAction(action) {
    const homeScreen = document.getElementById('home-screen');

    function safeShowModal(modalId, contentFn, delay = 150) {
        const modal = document.getElementById(modalId);
        if (!modal) {
            console.warn(`[桌面] 未找到模态框 #${modalId}`);
            return;
        }
        modal.classList.remove('hidden');
        if (modal._hideTimeout) {
            clearTimeout(modal._hideTimeout);
            modal._hideTimeout = null;
        }
        modal.style.display = 'flex';
        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';
        requestAnimationFrame(() => {
            const content = modal.querySelector('.modal-content');
            if (content) {
                content.style.opacity = '1';
                content.style.transform = 'translateY(0) scale(1)';
            }
        });
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
            if (homeScreen) {
                homeScreen.classList.remove('active');
                homeScreen._pendingActivation = false;
                // 停止定时器，避免在聊天界面空转
                if (window.homeBannerTimer) {
                    clearInterval(window.homeBannerTimer);
                    window.homeBannerTimer = null;
                }
            }
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

        case 'decision':
            safeShowModal('decision-menu-modal');
            break;

        case 'chatSettings':
            safeShowModal('chat-modal');
            break;

        case 'data':
            safeShowModal('data-modal');
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
            updateHomeSpacer();   // ← 新增
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

