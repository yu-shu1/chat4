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
            // --- 新增: 在欢迎动画结束后显示桌面 ---
            showHomeScreen();
            // --- 新增结束 ---
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
const stickerInput = document.getElementById('sticker-file-input');
            if (stickerInput) {
                stickerInput.addEventListener('change', async (e) => {
                    const files = Array.from(e.target.files);
                    if (!files.length) return;

                    const oversized = files.filter(f => f.size > 2 * 1024 * 1024);
                    if (oversized.length > 0) {
                        showNotification(oversized.length + ' 张图片超过 2MB 限制，已跳过', 'warning');
                    }

                    const validFiles = files.filter(f => f.size <= 2 * 1024 * 1024);
                    if (!validFiles.length) return;

                    showNotification('正在批量处理 ' + validFiles.length + ' 张图片...', 'info');

                    let successCount = 0;
                    let failCount = 0;

                    for (const file of validFiles) {
                        try {
                            const base64 = await optimizeImage(file, 300, 0.8);
                            stickerLibrary.push(base64);
                            successCount++;
                        } catch (err) {
                            console.error(err);
                            failCount++;
                        }
                    }

                    throttledSaveData();
                    renderReplyLibrary();

                    if (failCount > 0) {
                        showNotification('上传完成：' + successCount + ' 张成功，' + failCount + ' 张失败', 'warning');
                    } else {
                        showNotification('上传成功，共 ' + successCount + ' 张', 'success');
                    }

                    e.target.value = '';
                });
            }
const myStickerQuickUpload = document.getElementById('my-sticker-quick-upload');
if (myStickerQuickUpload) {
    myStickerQuickUpload.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const oversized = files.filter(f => f.size > 2 * 1024 * 1024);
        if (oversized.length > 0) showNotification(oversized.length + ' 张图片超过 2MB，已跳过', 'warning');
        const validFiles = files.filter(f => f.size <= 2 * 1024 * 1024);
        if (!validFiles.length) return;
        showNotification('正在处理 ' + validFiles.length + ' 张...', 'info');
        let ok = 0, fail = 0;
        for (const file of validFiles) {
            try {
                const base64 = await optimizeImage(file, 300, 0.8);
                myStickerLibrary.push(base64);
                ok++;
            } catch(err) { fail++; }
        }
        throttledSaveData();
        if (typeof renderComboContent === 'function') renderComboContent('my-sticker');
        showNotification(fail > 0 ? `上传完成：${ok} 成功 ${fail} 失败` : `✓ 已添加 ${ok} 张到我的表情库`, fail > 0 ? 'warning' : 'success');
        e.target.value = '';
    });
}

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
                // 如果模态框因其他样式导致不可见，强制设为可见
                modal.style.display = 'flex';
                modal.style.opacity = '1';
            }
        } catch(e) { 
            console.warn('Daily greeting timing error:', e); 
        }
    }, 1000);
});

// =============================================
// 新增：桌面层逻辑
// =============================================

/**
 * 显示桌面并初始化网格
 */
function showHomeScreen() {
    const homeScreen = document.getElementById('home-screen');
    if (!homeScreen) return;

    // 初始化横幅内容
    updateBannerGreeting();

    // 初始化底部网格
    initHomeGrid();

    // 激活桌面层
    homeScreen.classList.add('active');
}

/**
 * 更新横幅上的问候语
 */
function updateBannerGreeting() {
    const bannerEl = document.getElementById('banner-greeting');
    if (!bannerEl) return;

    const now = new Date();
    const hour = now.getHours();
    let timeGreeting = '下午好';
    if (hour < 6) timeGreeting = '夜深了';
    else if (hour < 12) timeGreeting = '早上好';
    else if (hour < 18) timeGreeting = '下午好';
    else timeGreeting = '晚上好';

    const partnerName = settings?.partnerName || '梦角';
    const myName = settings?.myName || '我';

    // 从自定义开场白中随机获取，如果没有则使用默认
    let introLine1 = '今天，想和你说说话';
    let introLine2 = '';

    if (customIntros && customIntros.length > 0) {
        const randomIntro = customIntros[Math.floor(Math.random() * customIntros.length)];
        const parts = randomIntro.split('|');
        introLine1 = parts[0] || introLine1;
        introLine2 = parts[1] || '';
    } else {
        // 内置一些备用
        const fallbacks = [
            ['✨', '我们之间，有说不完的话'],
            ['🌙', '想和你分享今天的每一刻'],
            ['☀️', '新的一天，从想你开始'],
            ['💫', '你的消息，是我最期待的'],
        ];
        const randomPick = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        introLine1 = randomPick[0] + ' ' + randomPick[1];
        introLine2 = '';
    }

    bannerEl.innerHTML = `
        <div style="font-size: 13px; color: var(--text-secondary); letter-spacing: 2px; margin-bottom: 4px;">${timeGreeting}</div>
        <div style="font-size: 20px; font-weight: 700; color: var(--text-primary);">
            ${introLine1}
        </div>
        ${introLine2 ? `<div style="font-size: 14px; color: var(--text-secondary); margin-top: 4px; opacity: 0.8;">${introLine2}</div>` : ''}
        <div style="margin-top: 12px; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary);">
            <span style="background: rgba(var(--accent-color-rgb), 0.15); padding: 2px 10px; border-radius: 20px;">💖 ${partnerName}</span>
            <span style="opacity: 0.3;">&</span>
            <span style="background: rgba(var(--accent-color-rgb), 0.08); padding: 2px 10px; border-radius: 20px;">${myName}</span>
        </div>
    `;
}

/**
 * 初始化功能网格
 */
function initHomeGrid() {
    const container = document.getElementById('home-grid-container');
    if (!container) return;

    // 定义功能列表: { id, icon, label, action }
    // 最多支持 3行*4列 = 12个功能
    const apps = [
        { id: 'chat', icon: 'fa-comment-dots', label: '对话', action: 'chat' },
        { id: 'mood', icon: 'fa-calendar-day', label: '心晴手账', action: 'mood' },
        { id: 'envelope', icon: 'fa-envelope', label: '留言板', action: 'envelope' },
        { id: 'stats', icon: 'fa-chart-bar', label: '消息统计', action: 'stats' },
        { id: 'fortune', icon: 'fa-star-and-crescent', label: '运势', action: 'fortune' },
        { id: 'anniversary', icon: 'fa-heart', label: '重要日', action: 'anniversary' },
        { id: 'settings', icon: 'fa-cog', label: '设置', action: 'settings' },
        { id: 'appearance', icon: 'fa-palette', label: '主题', action: 'appearance' },
        { id: 'customReplies', icon: 'fa-comment-dots', label: '字卡库', action: 'customReplies' },
        // 可以继续添加更多功能...
    ];

    container.innerHTML = '';

    apps.forEach(app => {
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

        container.appendChild(btn);
    });

    // 如果格子不满（少于12个），grid会自动处理对齐
    // 也可以添加空占位或装饰性元素
}

/**
 * 处理桌面功能点击
 */
function handleHomeAction(action) {
    const homeScreen = document.getElementById('home-screen');

    switch (action) {
        case 'chat':
            // 隐藏桌面，显示聊天界面
            if (homeScreen) homeScreen.classList.remove('active');
            // 可选：滚动到最新消息
            const chatContainer = document.getElementById('chat-container');
            if (chatContainer) {
                setTimeout(() => {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }, 100);
            }
            // 聚焦输入框
            const input = document.getElementById('message-input');
            if (input) setTimeout(() => input.focus(), 200);
            break;

        case 'mood':
            // 打开心情手账
            const moodModal = document.getElementById('mood-modal');
            if (moodModal && typeof showModal === 'function') {
                if (homeScreen) homeScreen.classList.remove('active');
                setTimeout(() => {
                    if (typeof renderMoodCalendar === 'function') renderMoodCalendar();
                    showModal(moodModal);
                }, 150);
            }
            break;

        case 'envelope':
            // 打开留言板
            const envelopeModal = document.getElementById('envelope-board-modal');
            if (envelopeModal && typeof showModal === 'function' && typeof renderEnvelopeBoard === 'function') {
                if (homeScreen) homeScreen.classList.remove('active');
                setTimeout(() => {
                    renderEnvelopeBoard();
                    showModal(envelopeModal);
                }, 150);
            }
            break;

        case 'stats':
            // 打开消息统计
            const statsModal = document.getElementById('stats-modal');
            if (statsModal && typeof showModal === 'function' && typeof renderStatsContent === 'function') {
                if (homeScreen) homeScreen.classList.remove('active');
                setTimeout(() => {
                    renderStatsContent();
                    showModal(statsModal);
                }, 150);
            }
            break;

        case 'fortune':
            // 打开运势占卜
            const fortuneModal = document.getElementById('fortune-lenormand-modal');
            if (fortuneModal && typeof showModal === 'function' && typeof generateFortune === 'function') {
                if (homeScreen) homeScreen.classList.remove('active');
                setTimeout(() => {
                    generateFortune();
                    switchFLTab('fortune');
                    showModal(fortuneModal);
                }, 150);
            }
            break;

        case 'anniversary':
            // 打开纪念日
            const annModal = document.getElementById('anniversary-modal');
            if (annModal && typeof showModal === 'function' && typeof renderAnniversariesList === 'function') {
                if (homeScreen) homeScreen.classList.remove('active');
                setTimeout(() => {
                    renderAnniversariesList();
                    showModal(annModal);
                }, 150);
            }
            break;

        case 'settings':
            // 打开设置
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal && typeof showModal === 'function') {
                if (homeScreen) homeScreen.classList.remove('active');
                setTimeout(() => showModal(settingsModal), 150);
            }
            break;

        case 'appearance':
            // 打开主题/外观设置
            const appearanceModal = document.getElementById('appearance-modal');
            if (appearanceModal && typeof showModal === 'function') {
                if (homeScreen) homeScreen.classList.remove('active');
                // 重置外观面板状态，确保显示正确
                if (typeof hideAppearancePanel === 'function') hideAppearancePanel();
                setTimeout(() => {
                    // 确保背景画廊和主题方案列表已渲染
                    if (typeof renderBackgroundGallery === 'function') renderBackgroundGallery();
                    if (typeof renderThemeSchemesList === 'function') renderThemeSchemesList();
                    showModal(appearanceModal);
                }, 150);
            }
            break;

        case 'customReplies':
            // 打开自定义回复/字卡库
            const replyModal = document.getElementById('custom-replies-modal');
            if (replyModal && typeof showModal === 'function') {
                if (homeScreen) homeScreen.classList.remove('active');
                setTimeout(() => {
                    currentMajorTab = 'reply';
                    currentSubTab = 'custom';
                    if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
                    showModal(replyModal);
                }, 150);
            }
            break;

        default:
            console.warn('未知的桌面操作:', action);
            break;
    }
}

// 暴露全局函数，以便在其他地方调用
window.showHomeScreen = showHomeScreen;
window.handleHomeAction = handleHomeAction;
window.initHomeGrid = initHomeGrid;
window.updateBannerGreeting = updateBannerGreeting;