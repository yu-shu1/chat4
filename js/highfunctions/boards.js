/**
 * board-v2.js - 双向线程留言板 (绝对隔离引擎版)
 * 修复：缺失元素判空、字卡库实时同步、防止初始化报错
 */
(function() {
'use strict';

const STORAGE_KEY = 'boardDataV2';
let currentView = 'me';
let currentThreadId = null;
let currentComposeMode = null;
let currentComposeType = null;
let selectedImage = null;

// --- 完全隔离的底层数据与配置 ---
let boardData = {
  myThreads: [], partnerThreads: [], boardReplyPool: [], unreadPartnerCount: 0,
  settings: {
    autoPostEnabled: false, nextAutoPostTime: 0
  }
};

// --- 工具函数 ---
function genId() { return 'v2_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6); }
function formatTime(ts) { return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function getUniqueShuffled(arr, count) {
  if (!arr || arr.length === 0) return [];
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  const unique = [], seen = new Set();
  for(const s of shuffled) { if(!seen.has(s)) { unique.push(s); seen.add(s); } if(unique.length >= count) break; }
  return unique;
}

// 强制把最新的主回复库同步给留言板，解决删除不同步的问题
function syncReplyPool() {
  if (typeof customReplies !== 'undefined') {
    boardData.boardReplyPool = [...customReplies];
    saveData(); // 存进本地，防止刷新页面后又变回老数据
  }
}

async function loadData() {
    try {
        const saved = await localforage.getItem(STORAGE_KEY);
        if (saved) boardData = { ...boardData, ...saved };
        
        // 精准吞噬老版 board.js 的 outbox/inbox 数据
        if (boardData.myThreads.length === 0 && boardData.partnerThreads.length === 0) {
            const count = await migrateOldBoardData();
            if (count > 0 && typeof showNotification === 'function') {
                showNotification(`已完美恢复 ${count} 条老留言记录`, 'success', 4000);
            }
        }

        // 保证回复池不为空（从 customReplies 同步）
        if (boardData.boardReplyPool.length === 0 && typeof customReplies !== 'undefined' && customReplies.length > 0) {
            boardData.boardReplyPool = JSON.parse(JSON.stringify(customReplies));
            await saveData();
        }
        window.boardDataV2 = boardData;
    } catch(e) {
        console.warn('BoardV2 load error', e);
    }
}

// 针对老版 board.js 的无损迁移
async function migrateOldBoardData() {
    try {
        const keys = await localforage.keys();
        const oldKey = keys.find(k => k.includes('envelopeData'));
        if (!oldKey) return 0;

        const oldData = await localforage.getItem(oldKey);
        if (!oldData) return 0;

        const outbox = (oldData.outbox || []).filter(l => l.content);
        const inbox = oldData.inbox || [];
        if (outbox.length === 0) return 0;

        console.log(`[BoardV2] 扫描到老版留言：${outbox.length} 条发件，${inbox.length} 条回复，开始拼接...`);
        outbox.forEach(letter => {
            const newThread = {
                id: letter.id || genId(),
                starter: 'me',
                createdAt: letter.sentTime || Date.now(),
                replies: [{
                    id: 'old_m_' + (letter.id || genId()),
                    sender: 'me',
                    text: letter.content,
                    image: null,
                    sticker: null,
                    timestamp: letter.sentTime || Date.now()
                }]
            };
            const matchedReply = inbox.find(r => r.refId === letter.id);
            if (matchedReply) {
                newThread.replies.push({
                    id: 'old_p_' + (matchedReply.id || genId()),
                    sender: 'partner',
                    text: matchedReply.content,
                    image: null,
                    sticker: null,
                    timestamp: matchedReply.receivedTime || Date.now()
                });
                if (matchedReply.isNew) newThread.unread = true;
            } else if (letter.status === 'pending' && letter.replyTime) {
                newThread.expectedReplyTime = letter.replyTime;
            }
            boardData.myThreads.push(newThread);
        });
        await saveData();
        return outbox.length;
    } catch (e) {
        console.error('[BoardV2] 老版数据迁移出错:', e);
        return 0;
    }
}

async function saveData() { try { await localforage.setItem(STORAGE_KEY, boardData); window.boardDataV2 = boardData; } catch(e) { console.warn('BoardV2 save error', e); } }

// 时间锚点引擎
function checkStatus() {
  const now = Date.now();
  const processReplies = (threads) => {
    threads.forEach(thread => {
      if (!thread.expectedReplyTime && thread.replies.length > 0) {
        const last = thread.replies[thread.replies.length - 1];
        if (last.sender === 'me') {
          thread.expectedReplyTime = last.timestamp + ((6 + Math.random() * 6) * 3600 * 1000);
          saveData();
        }
      }
      if (thread.expectedReplyTime && now >= thread.expectedReplyTime) {
          const reply = generatePartnerReply();
          if (reply) {
            thread.replies.push(...reply);
            delete thread.expectedReplyTime;
            thread.unread = true;
            saveData();
            if (currentThreadId === thread.id) setTimeout(() => openDetail(thread.id, currentView), 1000);
          }
        }
    });
  };
  processReplies(boardData.myThreads);
  processReplies(boardData.partnerThreads);

  // 主动留言逻辑
  if (boardData.settings.autoPostEnabled && (typeof settings === 'undefined' || settings.boardPartnerWriteEnabled)) {
    if (!boardData.settings.nextAutoPostTime || now >= boardData.settings.nextAutoPostTime) {
      boardData.settings.nextAutoPostTime = now + (4 * 3600 * 1000);
      saveData();
      if (Math.random() < 0.2) {
        const reply = generatePartnerReply();
        if (reply) {
          boardData.partnerThreads.push({ id: genId(), starter: 'partner', createdAt: now, replies: reply, unread: true });
          if (typeof showNotification === 'function') {
            const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '对方';
            showNotification(partnerName + '在留言板写了新内容', 'info', 2000);
          }
          if (typeof window._sendPartnerNotification === 'function') {
            const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '对方';
            window._sendPartnerNotification('留言板新动态', partnerName + '给你留了言');
          }
          saveData();
          if (currentView === 'partner') switchTab('partner');
        }
      }
    }
  }
}

function generatePartnerReply() {
    if (boardData.boardReplyPool.length === 0) {
        if (typeof showNotification === 'function') {
            showNotification('请先在自定义回复中添加字卡，留言板才能收到回复', 'warning', 4000);
        }
        return null;
    }
    const pool = boardData.boardReplyPool;
    const stickers = (typeof stickerLibrary !== 'undefined' && stickerLibrary.length > 0) ? [...stickerLibrary] : [];
    const emojis = (typeof customEmojis !== 'undefined' && customEmojis.length > 0) ? [...customEmojis] : [];
    if (pool.length === 0 && stickers.length === 0) return null;

    const count = 8 + Math.floor(Math.random() * 5);
    const uniquePool = getUniqueShuffled(pool, count);
    const punctuations = ['。', '！', '…', '～', '，', '、'];
    const rawSentences = uniquePool.map(s => s + punctuations[Math.floor(Math.random() * punctuations.length)]);

    let pickedStickers = [];
    if (stickers.length > 0 && Math.random() < 0.35) {
        const stickerCount = Math.random() < 0.5 ? 1 : 2;
        pickedStickers = getUniqueShuffled(stickers, stickerCount);
    }

    let finalText = '';
    const hasStickers = pickedStickers.length > 0;
    const maxEmoji = hasStickers ? 1 : 3;
    let usedEmoji = 0;

    if (emojis.length > 0 && Math.random() < 0.7) {
        rawSentences.forEach((sentence) => {
            finalText += sentence;
            if (usedEmoji < maxEmoji && Math.random() < 0.35) {
                const emoji = emojis[Math.floor(Math.random() * emojis.length)];
                finalText += emoji;
                usedEmoji++;
            }
        });
    } else {
        finalText = rawSentences.join('');
    }

    const replyObj = {
        id: genId(),
        sender: 'partner',
        text: finalText,
        image: null,
        sticker: null,
        stickers: pickedStickers,
        timestamp: Date.now()
    };
    return [replyObj];
}

// 绑定所有静态事件（修复：所有元素判空）
function bindStaticEvents() {
    // 列表关闭按钮
    const closeListBtn = document.getElementById('board-list-close-btn');
    if (closeListBtn) closeListBtn.onclick = () => hideModal(document.getElementById('envelope-board-modal'));

    // 导出、批量等按钮（原设计可能不存在，保险判空）
    const exportBtn = document.getElementById('board-export-btn');
    if (exportBtn) exportBtn.onclick = () => window._bv2_exportTxt(currentView);

    const cancelSelect = document.getElementById('board-cancel-select-btn');
    if (cancelSelect) cancelSelect.onclick = exitMultiSelectMode;
    const selectAll = document.getElementById('board-select-all-btn');
    if (selectAll) selectAll.onclick = () => {
        const threads = currentView === 'me' ? boardData.myThreads : boardData.partnerThreads;
        threads.forEach(t => selectedThreadIds.add(t.id));
        switchTab(currentView);
    };
    const confirmSelect = document.getElementById('board-confirm-select-btn');
    if (confirmSelect) confirmSelect.onclick = () => {
        if (selectedThreadIds.size === 0) {
            if(typeof showNotification === 'function') showNotification('请至少选择一条留言', 'warning');
            return;
        }
        const formatModal = document.getElementById('board-format-modal');
        if (formatModal && typeof showModal === 'function') showModal(formatModal);
        else if (formatModal) formatModal.style.display = 'flex';
    };
    const finalTxt = document.getElementById('final-export-txt');
    if (finalTxt) finalTxt.onclick = () => {
        const formatModal = document.getElementById('board-format-modal');
        if (formatModal) formatModal.style.display = 'none';
        window._bv2_exportSelected('txt');
    };
    const finalImg = document.getElementById('final-export-img');
    if (finalImg) finalImg.onclick = () => {
        const formatModal = document.getElementById('board-format-modal');
        if (formatModal) formatModal.style.display = 'none';
        window._bv2_exportSelected('img');
    };

    // 新建留言按钮
    const newPostBtn = document.getElementById('board-new-post-btn');
    if (newPostBtn) newPostBtn.onclick = () => window._bv2_openCompose('new', null, 'me');

    // 详情层按钮
    const backBtn = document.getElementById('board-detail-back-btn');
    if (backBtn) backBtn.onclick = () => {
        hideModal(document.getElementById('board-detail-modal'));
        showModal(document.getElementById('envelope-board-modal'));
    };
    const globalEditBtn = document.getElementById('board-global-edit-btn');
    if (globalEditBtn) globalEditBtn.onclick = () => window._bv2_toggleGlobalEdit();
    const deleteThreadBtn = document.getElementById('board-delete-thread-btn');
    if (deleteThreadBtn) deleteThreadBtn.onclick = () => {
        if (currentThreadId) window._bv2_deleteThread(currentThreadId, currentView);
    };
    const editCancelBtn = document.getElementById('board-edit-cancel-btn');
    if (editCancelBtn) editCancelBtn.onclick = () => window._bv2_cancelGlobalEdit();
    const editSaveBtn = document.getElementById('board-edit-save-btn');
    if (editSaveBtn) editSaveBtn.onclick = () => window._bv2_saveGlobalEdit();

    // 撰写层按钮
    const composeClose = document.getElementById('board-compose-close-btn');
    if (composeClose) composeClose.onclick = () => {
        hideModal(document.getElementById('board-compose-modal'));
        if (!window._bv2_composeFromDetail) {
            showModal(document.getElementById('envelope-board-modal'));
        } else {
            showModal(document.getElementById('board-detail-modal'));
        }
    };
    const composeCancel = document.getElementById('board-compose-cancel-btn');
    if (composeCancel) composeCancel.onclick = () => {
        hideModal(document.getElementById('board-compose-modal'));
        if (!window._bv2_composeFromDetail) {
            showModal(document.getElementById('envelope-board-modal'));
        } else {
            showModal(document.getElementById('board-detail-modal'));
        }
    };
    const composeSend = document.getElementById('board-compose-send-btn');
    if (composeSend) composeSend.onclick = () => window._bv2_submitPost();
    const imgInput = document.getElementById('bv2-compose-img-input');
    if (imgInput) imgInput.onchange = (e) => window._bv2_handleImgSelect(e);

    // 图片操作框
    const imgActionCancel = document.getElementById('board-img-action-cancel');
    if (imgActionCancel) imgActionCancel.onclick = () => hideModal(document.getElementById('board-img-action-modal'));
    const imgReplace = document.getElementById('board-img-replace-action');
    if (imgReplace) imgReplace.onclick = () => {
        hideModal(document.getElementById('board-img-action-modal'));
        if (window._bv2_pendingImgId) {
            document.getElementById('bv2-detail-img-input').click();
        }
    };
    const imgDelete = document.getElementById('board-img-delete-action');
    if (imgDelete) imgDelete.onclick = () => {
        hideModal(document.getElementById('board-img-action-modal'));
        if (window._bv2_pendingImgId && confirm('确定要删除这张图片吗？')) {
            if (!window._bv2_imgEdits) window._bv2_imgEdits = {};
            window._bv2_imgEdits[window._bv2_pendingImgId] = { action: 'delete' };
            const imgEl = document.getElementById(`bv2-img-${window._bv2_pendingImgId}`);
            if (imgEl) imgEl.style.display = 'none';
            window._bv2_pendingImgId = null;
        }
    };

    // 详情页替换图片用的文件选择器
    const detailImgInput = document.getElementById('bv2-detail-img-input');
    if (detailImgInput) {
        detailImgInput.onchange = async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            let base64 = '';
            if (typeof optimizeImage === 'function') {
                base64 = await optimizeImage(file);
            } else {
                base64 = await new Promise(resolve => {
                    const r = new FileReader();
                    r.onload = ev => resolve(ev.target.result);
                    r.readAsDataURL(file);
                });
            }
            if (window._bv2_pendingImgId) {
                if (!window._bv2_imgEdits) window._bv2_imgEdits = {};
                window._bv2_imgEdits[window._bv2_pendingImgId] = { action: 'replace', data: base64 };
                const imgWrapper = document.querySelector(`#bv2-img-${window._bv2_pendingImgId} img`);
                if (imgWrapper) imgWrapper.src = base64;
                window._bv2_pendingImgId = null;
            }
            e.target.value = '';
        };
    }
}

function initModals() {
  bindStaticEvents(); // 所有绑定都在此完成
}

// 打开留言板主界面
window.renderEnvelopeBoard = async function() {
    await loadData();
    syncReplyPool();      // 同步最新字卡库
    initModals();
    // 如果关闭了对方主动写留言板，且当前在对方界面，强制切回我的
    if (!(typeof settings !== 'undefined' && settings.boardPartnerWriteEnabled) && currentView === 'partner') {
        currentView = 'me';
    }
    switchTab(currentView);
    const modal = document.getElementById('envelope-board-modal');
    if (modal && typeof showModal === 'function') showModal(modal);
};

function switchTab(type) {
    const canAutoPost = typeof settings !== 'undefined' && settings.boardPartnerWriteEnabled;
    currentView = type;
    const isMe = type === 'me';
    const threads = isMe ? boardData.myThreads : boardData.partnerThreads;
    const myName = (typeof settings !== 'undefined' && settings.myName) || '我';
    const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '对方';

    // 渲染标签
    const tabArea = document.getElementById('board-tab-area');
    if (tabArea) {
        tabArea.innerHTML = `
        <div style="display:flex; gap:8px; align-items:center;">
            <button class="board-tab-btn ${isMe ? 'active' : ''}" data-tab="me" style="padding:6px 14px; border-radius:20px; border:1px solid var(--border-color); background:${isMe ? 'var(--accent-color)' : 'transparent'}; color:${isMe ? '#fff' : 'var(--text-secondary)'}; font-size:12px; font-weight:600; cursor:pointer; position:relative;">
                ${myName}${boardData.myThreads.some(t => t.unread) ? '<span style="position:absolute;top:-6px;right:-6px;font-size:14px;">✨</span>' : ''}
            </button>
            <button class="board-tab-btn ${!isMe ? 'active' : ''}" data-tab="partner" style="padding:6px 14px; border-radius:20px; border:1px solid var(--border-color); background:${!isMe ? 'var(--accent-color)' : 'transparent'}; color:${!isMe ? '#fff' : 'var(--text-secondary)'}; font-size:12px; font-weight:600; cursor:pointer; position:relative;">
                ${partnerName}${boardData.partnerThreads.some(t => t.unread) ? '<span style="position:absolute;top:-6px;right:-6px;font-size:14px;">✨</span>' : ''}
            </button>
        </div>`;
        tabArea.querySelectorAll('[data-tab]').forEach(btn => {
            btn.onclick = () => switchTab(btn.dataset.tab);
        });
    }

    // 列表内容
    const listBody = document.getElementById('board-list-body');
    if (listBody) {
        if (threads.length === 0) {
            listBody.innerHTML = `<div class="board-empty"><i class="fas fa-sticky-note"></i><p>${isMe ? '还没有留言' : 'Ta还没有主动留言'}</p></div>`;
        } else {
            listBody.innerHTML = threads.slice().reverse().map(t => {
                const last = t.replies[t.replies.length - 1];
                let statusText = '等待回复', statusClass = 'pending';
                if (last && ((isMe && last.sender === 'partner') || (!isMe && last.sender === 'me'))) {
                    statusText = '已回复'; statusClass = 'replied';
                }
                const preview = t.replies[0] ? (t.replies[0].image ? '🖼 图片留言' : escapeHtml((t.replies[0].text || '').substring(0, 40))) : '';
                const unreadStar = t.unread ? '<span style="position:absolute;top:12px;right:12px;font-size:14px;z-index:2;">✨</span>' : '';
                return `<div class="board-card" data-thread-id="${t.id}" style="position:relative;cursor:pointer;">${unreadStar}<div class="board-card-top-line"></div><div class="board-card-body"><div class="board-card-preview">${preview}</div><div class="board-card-meta"><span class="board-card-date">${formatTime(t.createdAt)}</span><span class="board-card-status ${statusClass}">${statusText}</span></div></div></div>`;
            }).join('');
            listBody.querySelectorAll('[data-thread-id]').forEach(card => {
                card.onclick = () => {
                    const tid = card.dataset.threadId;
                    openDetail(tid, currentView);
                };
            });
        }
    }

    // 底部按钮（仅“我”的视图显示新建按钮）
    const newPostBtn = document.getElementById('board-new-post-btn');
    if (newPostBtn) newPostBtn.style.display = isMe ? 'flex' : 'none';
}

function openDetail(threadId, type) {
    currentThreadId = threadId;
    const threads = type === 'me' ? boardData.myThreads : boardData.partnerThreads;
    const thread = threads.find(t => t.id === threadId);
    if (!thread) return;
    if (thread.unread) {
        thread.unread = false; saveData();
        if (document.getElementById('envelope-board-modal')?.style.display !== 'none') switchTab(currentView);
    }
    const myName = (typeof settings !== 'undefined' && settings.myName) || '我';
    const partnerName = (typeof settings !== 'undefined' && settings.partnerName) || '对方';
    const isMe = type === 'me';
    restoreDetailViewUI();
    let bodyHtml = '';

    thread.replies.forEach((r, idx) => {
        const isSenderMe = r.sender === 'me';
        const isStarter = idx === 0;
        let cHtml = '';
        if (r.text) cHtml += `<div class="${isSenderMe ? 'board-user-text' : 'board-reply-text'}" id="bv2-text-${r.id}">${escapeHtml(r.text)}</div>`;
        if (r.image) cHtml += `<div id="bv2-img-${r.id}" class="${isSenderMe ? 'board-user-text' : 'board-reply-text'}" style="display:inline-block; position:relative; margin-bottom:8px;"><img src="${r.image}" style="max-width:150px;border-radius:8px;display:block;cursor:pointer;" onclick="viewImage('${r.image}')"></div>`;
        if (r.stickers && r.stickers.length > 0) {
            cHtml += `<div style="position:relative; display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;margin-bottom:8px; padding-left:40px;">`;
            r.stickers.forEach(st => {
                cHtml += `<img src="${st}" style="max-width:120px; max-height:120px; border-radius:8px; object-fit:contain;">`;
            });
            cHtml += '</div>';
        }

        const sectionClass = isStarter ? 'board-user-section' : 'board-reply-section';
        const labelClass = isStarter ? 'board-user-label' : 'board-reply-label';
        const labelText = isStarter ? ' 的留言' : ' 的回复';
        const senderName = isSenderMe ? myName : partnerName;
        bodyHtml += `<div class="${sectionClass}" id="bv2-section-${r.id}"><div class="${labelClass}">${senderName}${labelText}</div>${cHtml}</div>`;

        // 系统提示（点赞等）
        const isLast = idx === thread.replies.length - 1;
        const nextIsPartner = thread.replies[idx + 1]?.sender === 'partner';
        if (!isMe && isLast && r.sender === 'partner' && r.liked) {
            bodyHtml += `<div class="board-system-hint">${myName} 赞了 ${partnerName} 的留言</div>`;
        } else if (!isMe && !isLast && r.sender === 'partner' && r.liked && thread.replies[idx + 1]?.sender === 'me') {
            bodyHtml += `<div class="board-system-hint">${myName} 赞了 ${partnerName} 的留言</div>`;
        } else if (r.sender === 'me' && r.liked && nextIsPartner) {
            bodyHtml += `<div class="board-system-hint">${partnerName} 赞了 ${myName} 的留言</div>`;
        }
    });

    const last = thread.replies[thread.replies.length - 1];
    let actionHtml = '';
    if (last) {
        if (!isMe && last.sender === 'partner') {
            actionHtml = `<button class="board-add-btn" style="margin-top:16px;" id="board-reply-btn"><i class="fas fa-pen"></i> 回复</button>`;
        } else if (isMe && last.sender === 'partner') {
            actionHtml = `<button class="board-add-btn" style="margin-top:16px;" id="board-continue-btn"><i class="fas fa-pen"></i> 继续留言</button>`;
        } else {
            actionHtml = `<div class="board-waiting-reply" style="margin-top:16px;"><i class="fas fa-hourglass-half"></i> 等待回复中...</div>`;
        }
    }

    const detailBody = document.getElementById('board-detail-body');
    if (detailBody) detailBody.innerHTML = bodyHtml + actionHtml;
    const detailDate = document.getElementById('board-detail-date');
    if (detailDate) detailDate.textContent = new Date(thread.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

    const continueBtn = document.getElementById('board-continue-btn');
    const replyBtn = document.getElementById('board-reply-btn');
    if (continueBtn) continueBtn.onclick = () => window._bv2_openCompose('continue', threadId, 'me');
    if (replyBtn) replyBtn.onclick = () => window._bv2_openCompose('reply', threadId, 'partner');

    hideModal(document.getElementById('envelope-board-modal'));
    setTimeout(() => {
        showModal(document.getElementById('board-detail-modal'));
        const p = document.querySelector('.board-paper');
        if (p) p.scrollTop = p.scrollHeight;
    }, 100);
}

function openCompose(mode, threadId, type) {
    currentComposeMode = mode;
    currentThreadId = threadId;
    currentComposeType = type;
    window._bv2_composeFromDetail = (mode !== 'new');
    selectedImage = null;
    const titleMap = { new: '写新留言', continue: '继续留言', reply: '回复Ta' };
    const titleEl = document.getElementById('board-compose-title-text');
    if (titleEl) titleEl.textContent = titleMap[mode] || '写新留言';
    const textarea = document.getElementById('bv2-compose-text');
    if (textarea) textarea.value = '';
    const imgHint = document.getElementById('bv2-img-hint');
    if (imgHint) imgHint.style.display = 'none';
    const imgInput = document.getElementById('bv2-compose-img-input');
    if (imgInput) imgInput.value = '';

    hideModal(document.getElementById('board-detail-modal'));
    setTimeout(() => {
        showModal(document.getElementById('board-compose-modal'));
        if (textarea) textarea.focus();
    }, 100);
}

function handleImgSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (typeof optimizeImage === 'function') {
        optimizeImage(file).then(b => { selectedImage = b; const hint = document.getElementById('bv2-img-hint'); if (hint) hint.style.display = 'inline'; });
    } else {
        const r = new FileReader();
        r.onload = ev => { selectedImage = ev.target.result; const hint = document.getElementById('bv2-img-hint'); if (hint) hint.style.display = 'inline'; };
        r.readAsDataURL(file);
    }
}

async function submitPost() {
    const textarea = document.getElementById('bv2-compose-text');
    const text = textarea ? textarea.value.trim() : '';
    if (!text && !selectedImage) {
        if (typeof showNotification === 'function') showNotification('内容不能为空', 'warning');
        return;
    }
    const newReply = { id: genId(), sender: 'me', text, image: selectedImage || null, sticker: null, timestamp: Date.now() };
    if (currentComposeMode === 'new') {
        boardData.myThreads.push({ id: genId(), starter: 'me', createdAt: Date.now(), replies: [newReply] });
    } else {
        const threads = (currentComposeType === 'me' ? boardData.myThreads : boardData.partnerThreads);
        const t = threads.find(t => t.id === currentThreadId);
        if (t) { t.replies.push(newReply); delete t.expectedReplyTime; }
    }
    await saveData();
    checkStatus();

    hideModal(document.getElementById('board-compose-modal'));
    if (typeof showNotification === 'function') showNotification('发布成功', 'success');

    if (currentComposeMode === 'new') {
        switchTab(currentComposeType);
        showModal(document.getElementById('envelope-board-modal'));
    } else {
        setTimeout(() => openDetail(currentThreadId, currentComposeType), 100);
    }
}

function findReplyById(id) {
    for (let t of boardData.myThreads) { const r = t.replies.find(x => x.id === id); if(r) return r; }
    for (let t of boardData.partnerThreads) { const r = t.replies.find(x => x.id === id); if(r) return r; }
    return null;
}

function editText(replyId) {
    const textEl = document.getElementById(`bv2-text-${replyId}`);
    if (!textEl || textEl.classList.contains('editing')) return;
    const originalText = textEl.textContent;
    textEl.contentEditable = true;
    textEl.classList.add('editing');
    textEl.focus();
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const section = document.getElementById(`bv2-section-${replyId}`);
    if (section && !section.querySelector('.board-edit-actions')) {
        const actions = document.createElement('div');
        actions.className = 'board-edit-actions';
        actions.innerHTML = `<button class="board-edit-btn cancel" onclick="window._bv2_cancelEdit('${replyId}')">取消</button><button class="board-edit-btn save" onclick="window._bv2_saveEdit('${replyId}')">保存</button>`;
        section.appendChild(actions);
    }
    textEl.dataset.originalText = originalText;
}

async function saveEdit(replyId) {
    const textEl = document.getElementById(`bv2-text-${replyId}`);
    if (!textEl) return;
    const newText = textEl.textContent.trim();
    if (!newText) { if(typeof showNotification === 'function') showNotification('内容不能为空', 'warning'); return; }
    const reply = findReplyById(replyId);
    if (reply) { reply.text = newText; await saveData(); if(typeof showNotification === 'function') showNotification('已保存', 'success'); }
    exitEditMode(replyId);
}

function cancelEdit(replyId) {
    const textEl = document.getElementById(`bv2-text-${replyId}`);
    if (!textEl) return;
    textEl.textContent = textEl.dataset.originalText || '';
    exitEditMode(replyId);
}

function exitEditMode(replyId) {
    const textEl = document.getElementById(`bv2-text-${replyId}`);
    if(textEl) { textEl.contentEditable = false; textEl.classList.remove('editing'); delete textEl.dataset.originalText; }
    const section = document.getElementById(`bv2-section-${replyId}`);
    if (section) { const actions = section.querySelector('.board-edit-actions'); if (actions) actions.remove(); }
}

async function deleteThread(id, type) {
    if (!confirm('确定删除这条留言记录吗？')) return;
    if (type === 'me') boardData.myThreads = boardData.myThreads.filter(t => t.id !== id);
    else boardData.partnerThreads = boardData.partnerThreads.filter(t => t.id !== id);
    await saveData();

    hideModal(document.getElementById('board-detail-modal'));
    switchTab(type);
    showModal(document.getElementById('envelope-board-modal'));
    if(typeof showNotification === 'function') showNotification('已删除', 'success');
}

// 全局编辑
window._bv2_toggleGlobalEdit = function() {
  const threads = currentView === 'me' ? boardData.myThreads : boardData.partnerThreads;
  const thread = threads.find(t => t.id === currentThreadId);
  if (!thread) return;
  const editBar = document.getElementById('board-edit-actions-bar');
  const penBtn = document.getElementById('board-global-edit-btn');
  const deleteBtn = document.getElementById('board-delete-thread-btn');
  if (editBar && editBar.style.display === 'flex') {
    window._bv2_saveGlobalEdit();
    return;
  }
  window._bv2_imgEdits = {};

  const hasImg = thread.replies.some(r => r.image);
  if (hasImg) {
    const hint = document.createElement('div');
    hint.id = 'bv2-img-edit-hint';
    hint.style.cssText = 'font-size:12px; color:var(--text-secondary); margin-bottom:12px; text-align:center;';
    hint.textContent = '点击图片可进行替换或删除';
    if (editBar && editBar.parentElement) editBar.parentElement.insertBefore(hint, editBar);
  }

  thread.replies.forEach(r => {
    if (r.text) {
      const el = document.getElementById(`bv2-text-${r.id}`);
      if (el) {
        el.dataset.originalText = el.textContent;
        el.contentEditable = true;
        el.classList.add('editing');
      }
    }
  });

  thread.replies.forEach(r => {
    if (r.image) {
      const imgWrapper = document.getElementById(`bv2-img-${r.id}`);
      const imgEl = imgWrapper ? imgWrapper.querySelector('img') : null;
      if (imgEl) {
        imgEl.dataset.origOnclick = imgEl.getAttribute('onclick');
        imgEl.removeAttribute('onclick');
        imgEl.style.cursor = 'pointer';
        imgEl.onclick = function(e) {
          e.stopPropagation();
          window._bv2_pendingImgId = r.id;
          const imgActionModal = document.getElementById('board-img-action-modal');
          if (imgActionModal && typeof showModal === 'function') showModal(imgActionModal);
          else if (imgActionModal) imgActionModal.style.display = 'flex';
        };
      }
    }
  });

  if (editBar) editBar.style.display = 'flex';
  if (penBtn) penBtn.style.display = 'none';
  if (deleteBtn) deleteBtn.style.display = 'none';
  const originalActions = document.querySelector('.board-paper-content > .board-add-btn, .board-paper-content > .board-waiting-reply');
  if (originalActions) originalActions.style.display = 'none';
};

window._bv2_saveGlobalEdit = async function() {
  const threads = currentView === 'me' ? boardData.myThreads : boardData.partnerThreads;
  const thread = threads.find(t => t.id === currentThreadId);
  if (!thread) return;
  let needSave = false;

  thread.replies.forEach(r => {
    if (r.text) {
      const el = document.getElementById(`bv2-text-${r.id}`);
      if (el && el.classList.contains('editing')) {
        const newText = el.textContent.trim();
        if (newText && newText !== r.text) { r.text = newText; needSave = true; }
        el.contentEditable = false;
        el.classList.remove('editing');
        delete el.dataset.originalText;
      }
    }
  });

  const edits = window._bv2_imgEdits || {};
  const hadImgChange = Object.keys(edits).length > 0;
  Object.keys(edits).forEach(replyId => {
    const reply = thread.replies.find(x => x.id === replyId);
    if (!reply) return;
    if (edits[replyId].action === 'delete' && reply.image) {
      reply.image = null;
      needSave = true;
    } else if (edits[replyId].action === 'replace' && edits[replyId].data) {
      reply.image = edits[replyId].data;
      needSave = true;
    }
  });
  window._bv2_imgEdits = {};

  if (needSave) {
    await saveData();
    if(typeof showNotification === 'function') showNotification('修改已保存', 'success');
    if (hadImgChange) {
      openDetail(currentThreadId, currentView);
      return;
    }
  }
  restoreDetailViewUI();
};

window._bv2_cancelGlobalEdit = function() {
    const threads = currentView === 'me' ? boardData.myThreads : boardData.partnerThreads;
    const thread = threads.find(t => t.id === currentThreadId);
    if (!thread) return;

    thread.replies.forEach(r => {
        if (r.text) {
            const el = document.getElementById(`bv2-text-${r.id}`);
            if (el && el.classList.contains('editing')) {
                el.textContent = el.dataset.originalText || r.text;
                el.contentEditable = false;
                el.classList.remove('editing');
                delete el.dataset.originalText;
            }
        }
    });

    document.querySelectorAll('.img-edit-overlay').forEach(ov => ov.remove());
    thread.replies.forEach(r => {
        if (r.image) {
            const imgWrapper = document.getElementById(`bv2-img-${r.id}`);
            const imgEl = imgWrapper ? imgWrapper.querySelector('img') : null;
            if (imgEl) {
                if (imgEl.dataset.origOnclick) {
                    imgEl.setAttribute('onclick', imgEl.dataset.origOnclick);
                    delete imgEl.dataset.origOnclick;
                }
                imgEl.onclick = null;
                imgEl.style.opacity = '1';
                imgEl.classList.remove('editing');
                if (imgWrapper) imgWrapper.style.display = 'inline-block';
            }
        }
    });

    window._bv2_imgEdits = {};
    restoreDetailViewUI();
};

function restoreDetailViewUI() {
  const editBar = document.getElementById('board-edit-actions-bar');
  const penBtn = document.querySelector('.board-detail-actions .board-detail-action-btn:not(.delete)');
  const deleteBtn = document.querySelector('.board-detail-actions .board-detail-action-btn.delete');
  const originalActions = document.querySelector('.board-paper-content > .board-add-btn, .board-paper-content > .board-waiting-reply');
  if (editBar) editBar.style.display = 'none';
  if (penBtn) penBtn.style.display = 'flex';
  if (deleteBtn) deleteBtn.style.display = 'flex';
  if (originalActions) originalActions.style.display = '';
  const hint = document.getElementById('bv2-img-edit-hint');
  if (hint) hint.remove();
}

// 对外暴露接口
window.loadEnvelopeData = loadData;
window.checkEnvelopeStatus = checkStatus;
window.setBoardDataV2 = function(newData) {
    boardData = { ...boardData, ...newData };
    window.boardDataV2 = boardData;
    saveData();
};
window._bv2_openCompose = openCompose;
window._bv2_submitPost = submitPost;
window._bv2_handleImgSelect = handleImgSelect;
window._bv2_deleteThread = deleteThread;
window._bv2_editText = editText;
window._bv2_saveEdit = saveEdit;
window._bv2_cancelEdit = cancelEdit;
window._bv2_toggleGlobalEdit = _bv2_toggleGlobalEdit;
window._bv2_saveGlobalEdit = _bv2_saveGlobalEdit;
window._bv2_cancelGlobalEdit = _bv2_cancelGlobalEdit;

// 启动
loadData().then(() => { setInterval(checkStatus, 60000); checkStatus(); });

})();