        // Ensure default admin credentials exist
        if (!localStorage.getItem('sms_admin_username')) {
            localStorage.setItem('sms_admin_username', 'admin');
            localStorage.setItem('sms_admin_password', 'admin123');
        }
        function rebuildStockAndUI() {
            const newStock = {};

            // 1. Process all purchases (adds to stock)
            const purchases = ERP_STATE.purchaseLog || [];
            purchases.forEach(p => {
                const key = getStockKey(p.color, p.size, p.clarity);
                newStock[key] = (newStock[key] || 0) + p.carats;
            });

            // 2. Process all sales (subtracts from stock)
            const sales = ERP_STATE.salesLog || [];
            sales.forEach(s => {
                const key = getStockKey(s.color, s.size, s.clarity);
                newStock[key] = (newStock[key] || 0) - s.carats;
            });

            // 3. Remove zero/near-zero balances
            for (const [key, qty] of Object.entries(newStock)) {
                if (Math.abs(qty) < 0.0001) {
                    delete newStock[key];
                }
            }

            // 4. Apply to state
            ERP_STATE.stock = newStock;
            
            // 5. Re-render UI components
            renderAllDataComponents();
        }

        // Storage interfaces are left fully enabled for local offline caching and sync

        // Generate stable client browser fingerprint
        function getBrowserFingerprint() {
            const parts = [
                navigator.userAgent,
                navigator.language,
                navigator.platform,
                navigator.hardwareConcurrency || 4,
                navigator.deviceMemory || 0,
                new Date().getTimezoneOffset()
            ];
            const str = parts.join('###');
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            return 'FP-' + Math.abs(hash);
        }



        // Helper functions for notepad and sieve pricing cached variables (stored in-memory & synced to cloud)
        function getStorageItem(key) {
            if (key === 'sms_notepad_text') {
                return ERP_STATE.notepadText || '';
            }
            if (key.startsWith('last-bhav-')) {
                ERP_STATE.lastBhav = ERP_STATE.lastBhav || {};
                return ERP_STATE.lastBhav[key] || '';
            }
            return null;
        }

        function setStorageItem(key, value) {
            if (key === 'sms_notepad_text') {
                ERP_STATE.notepadText = value;
                saveDatabaseState();
            } else if (key.startsWith('last-bhav-')) {
                ERP_STATE.lastBhav = ERP_STATE.lastBhav || {};
                ERP_STATE.lastBhav[key] = value;
                saveDatabaseState();
            }
        }

        let isSyncingFromFirebase = false;

        function updateFirebaseStatusBadge(status) {
            const badge = document.getElementById('firebase-status-badge');
            if (!badge) return;
            
            badge.style.display = 'flex';
            const dot = badge.querySelector('.status-dot');
            const textEl = badge.querySelector('.status-text');
            
            if (status === 'online') {
                badge.style.background = '#2ecc71';
                if (textEl) textEl.innerText = 'FIREBASE CONNECTED';
                if (dot) dot.style.backgroundColor = '#ffffff';
            } else if (status === 'connecting') {
                badge.style.background = '#e67e22';
                if (textEl) textEl.innerText = 'FIREBASE CONNECTING';
                if (dot) dot.style.backgroundColor = '#ffffff';
            } else if (status === 'error') {
                badge.style.background = '#e74c3c';
                if (textEl) textEl.innerText = 'FIREBASE ERROR';
                if (dot) dot.style.backgroundColor = '#ffffff';
            } else {
                badge.style.background = '#7f8c8d';
                if (textEl) textEl.innerText = 'FIREBASE OFFLINE';
                if (dot) dot.style.backgroundColor = '#ffffff';
            }
        }

        function pushStateToFirebase() {
            if (isSyncingFromFirebase) return;
            if (typeof firebase === 'undefined' || !firebase.apps.length) return;
            
            const db = firebase.database();
            db.ref('erp_state').set({
                stock: ERP_STATE.stock || {},
                purchaseLog: ERP_STATE.purchaseLog || [],
                salesLog: ERP_STATE.salesLog || [],
                rojmel: ERP_STATE.rojmel || [],
                payments: ERP_STATE.payments || [],
                adjEntries: ERP_STATE.adjEntries || [],
                auditTrail: ERP_STATE.auditTrail || [],
                invoiceCounters: ERP_STATE.invoiceCounters || { purchase: 1, sale: 1 },
                masters: ERP_STATE.masters || {},
                invoiceMetadata: ERP_STATE.invoiceMetadata || {},
                assortRecords: ERP_STATE.assortRecords || [],
                assortLearningMatrix: ERP_STATE.assortLearningMatrix || {},
                assortStaff: ERP_STATE.assortStaff || [],
                assortLostFound: ERP_STATE.assortLostFound || [],
                manualBackups: ERP_STATE.manualBackups || [],
                lastManualBackupTime: ERP_STATE.lastManualBackupTime || '',
                adminUsername: ERP_STATE.adminUsername || 'admin',
                adminPassword: ERP_STATE.adminPassword || 'admin123',
                editPassword: ERP_STATE.editPassword || 'edit123',
                autoLogoutHours: ERP_STATE.autoLogoutHours || 12,
                rateDeviationMode: ERP_STATE.rateDeviationMode || 'percentage',
                rateDeviationVal: ERP_STATE.rateDeviationVal !== undefined ? ERP_STATE.rateDeviationVal : 10,
                shortcuts: ERP_STATE.shortcuts || {},
                notepadText: ERP_STATE.notepadText || '',
                lastBhav: ERP_STATE.lastBhav || {}
            }).catch(err => {
                console.error("Firebase push failed", err);
                updateFirebaseStatusBadge('error');
            });
        }

        function initializeFirebase() {
            if (typeof firebase === 'undefined') {
                console.warn("Firebase SDK not loaded");
                updateFirebaseStatusBadge('offline');
                return;
            }
            
            const firebaseConfig = {
                apiKey: "AIzaSyAA72jfISxLmlaWvU1q--dOAIXP5-6OF0U",
                authDomain: "sms-j-123.firebaseapp.com",
                databaseURL: "https://sms-j-123-default-rtdb.firebaseio.com",
                projectId: "sms-j-123",
                storageBucket: "sms-j-123.firebasestorage.app",
                messagingSenderId: "793800397695",
                appId: "1:793800397695:web:0c869d6c578eb4b165804a"
            };
            
            try {
                if (!firebase.apps.length) {
                    firebase.initializeApp(firebaseConfig);
                }
                
                updateFirebaseStatusBadge('connecting');
                const db = firebase.database();
                
                // Track connection status
                const connectedRef = db.ref(".info/connected");
                connectedRef.on("value", (snap) => {
                    if (snap.val() === true) {
                        updateFirebaseStatusBadge('online');
                    } else {
                        updateFirebaseStatusBadge('connecting');
                    }
                });

                // Listen for database changes
                db.ref('erp_state').on('value', (snapshot) => {
                    const val = snapshot.val();
                    if (!val) {
                        // Firebase is empty, initialize it with current local state
                        console.log("Firebase database is empty. Initializing with local data...");
                        pushStateToFirebase();
                        return;
                    }
                    
                    console.log("Received database state from Firebase");
                    isSyncingFromFirebase = true;
                    try {
                        // Apply value to ERP_STATE
                        if (val.stock) ERP_STATE.stock = val.stock;
                        if (val.purchaseLog) ERP_STATE.purchaseLog = val.purchaseLog;
                        if (val.salesLog) ERP_STATE.salesLog = val.salesLog;
                        if (val.rojmel) ERP_STATE.rojmel = val.rojmel;
                        if (val.payments) ERP_STATE.payments = val.payments;
                        if (val.adjEntries) ERP_STATE.adjEntries = val.adjEntries;
                        if (val.auditTrail) ERP_STATE.auditTrail = val.auditTrail;
                        if (val.invoiceCounters) ERP_STATE.invoiceCounters = val.invoiceCounters;
                        if (val.masters) ERP_STATE.masters = val.masters;
                        if (val.invoiceMetadata) ERP_STATE.invoiceMetadata = val.invoiceMetadata;
                        if (val.assortRecords) ERP_STATE.assortRecords = val.assortRecords;
                        if (val.assortLearningMatrix) ERP_STATE.assortLearningMatrix = val.assortLearningMatrix;
                        if (val.assortStaff) ERP_STATE.assortStaff = val.assortStaff;
                        if (val.assortLostFound) ERP_STATE.assortLostFound = val.assortLostFound;
                        if (val.manualBackups) ERP_STATE.manualBackups = val.manualBackups;
                        if (val.lastManualBackupTime !== undefined) ERP_STATE.lastManualBackupTime = val.lastManualBackupTime;
                        
                        if (val.adminUsername) ERP_STATE.adminUsername = val.adminUsername;
                        if (val.adminPassword) ERP_STATE.adminPassword = val.adminPassword;
                        if (val.editPassword) ERP_STATE.editPassword = val.editPassword;
                        if (val.autoLogoutHours) ERP_STATE.autoLogoutHours = val.autoLogoutHours;
                        if (val.rateDeviationMode) ERP_STATE.rateDeviationMode = val.rateDeviationMode;
                        if (val.rateDeviationVal !== undefined) ERP_STATE.rateDeviationVal = val.rateDeviationVal;
                        if (val.shortcuts) ERP_STATE.shortcuts = val.shortcuts;
                        if (val.notepadText !== undefined) ERP_STATE.notepadText = val.notepadText;
                        if (val.lastBhav) ERP_STATE.lastBhav = val.lastBhav;
                        
                        // Save locally
                        localStorage.setItem('sms_stock', JSON.stringify(ERP_STATE.stock || {}));
                        localStorage.setItem('sms_purchaseLog', JSON.stringify(ERP_STATE.purchaseLog || []));
                        localStorage.setItem('sms_salesLog', JSON.stringify(ERP_STATE.salesLog || []));
                        localStorage.setItem('sms_rojmel', JSON.stringify(ERP_STATE.rojmel || []));
                        localStorage.setItem('sms_payments', JSON.stringify(ERP_STATE.payments || []));
                        localStorage.setItem('sms_adjEntries', JSON.stringify(ERP_STATE.adjEntries || []));
                        localStorage.setItem('sms_auditTrail', JSON.stringify(ERP_STATE.auditTrail || []));
                        localStorage.setItem('sms_invoiceCounters', JSON.stringify(ERP_STATE.invoiceCounters || { purchase: 1, sale: 1 }));
                        localStorage.setItem('sms_masters', JSON.stringify(ERP_STATE.masters || {}));
                        localStorage.setItem('sms_invoiceMetadata', JSON.stringify(ERP_STATE.invoiceMetadata || {}));
                        
                        localStorage.setItem('sms_assortRecords', JSON.stringify(ERP_STATE.assortRecords || []));
                        localStorage.setItem('sms_learningMatrix', JSON.stringify(ERP_STATE.assortLearningMatrix || {}));
                        localStorage.setItem('sms_assortStaff', JSON.stringify(ERP_STATE.assortStaff || []));
                        localStorage.setItem('sms_assortLostFound', JSON.stringify(ERP_STATE.assortLostFound || []));
                        
                        localStorage.setItem('sms_manualBackups', JSON.stringify(ERP_STATE.manualBackups || []));
                        localStorage.setItem('sms_lastBackupTime', ERP_STATE.lastManualBackupTime || '');

                        localStorage.setItem('sms_admin_username', ERP_STATE.adminUsername || 'admin');
                        localStorage.setItem('sms_admin_password', ERP_STATE.adminPassword || 'admin123');
                        localStorage.setItem('sms_edit_password', ERP_STATE.editPassword || 'edit123');
                        localStorage.setItem('sms_auto_logout_duration', (ERP_STATE.autoLogoutHours || 12).toString());
                        localStorage.setItem('sms_rate_deviation_mode', ERP_STATE.rateDeviationMode || 'percentage');
                        localStorage.setItem('sms_rate_deviation_val', (ERP_STATE.rateDeviationVal !== undefined ? ERP_STATE.rateDeviationVal : 10).toString());
                        localStorage.setItem('sms_settings_shortcuts', JSON.stringify(ERP_STATE.shortcuts || {}));
                        
                        localStorage.setItem('sms_notepad_text', ERP_STATE.notepadText || '');
                        localStorage.setItem('sms_last_bhav', JSON.stringify(ERP_STATE.lastBhav || {}));
                        
                        // Normalize database state locally
                        normalizeDatabaseState(false);
                        
                        // Re-render UI components
                        refreshAllMasterSelectors();
                        renderAllDataComponents();
                        renderBackupHistory();
                        updateBackupReminderUI();
                        
                        updateFirebaseStatusBadge('online');
                    } finally {
                        isSyncingFromFirebase = false;
                    }
                }, (error) => {
                    console.error("Firebase read error", error);
                    updateFirebaseStatusBadge('error');
                });
            } catch (err) {
                console.error("Firebase init failed", err);
                updateFirebaseStatusBadge('error');
            }
        }

        // Global ERP Runtime Application State
        const ERP_STATE = {
            masters: {
                colors: ['White', 'BLC', 'Fancy Group'],
                sizes: ['-2', '+2', 'MIX'],
                numbers: ['WH 1 VVS', 'WH 1 VS SI', 'Wh vs colour', 'WH 2', 'NW 1', 'NW 2', 'ow1 better', 'OW 1', 'ttlb', 'dark lb', 'Wh 3', 'RIPER', 'table chari', 'Lc fancy'],
                purities: ['WH 1 VVS', 'WH 1 VS SI', 'Wh vs colour', 'WH 2', 'NW 1', 'NW 2', 'ow1 better', 'OW 1', 'ttlb', 'dark lb', 'Wh 3', 'RIPER', 'table chari', 'Lc fancy'],
                parties: [],
                brokers: [],
                seriesPurities: ['WH 1 VVS', 'WH 1 VS SI', 'Wh vs colour', 'WH 2', 'NW 1', 'NW 2', 'ow1 better', 'OW 1', 'ttlb', 'dark lb', 'Wh 3', 'RIPER', 'table chari', 'Lc fancy']
            },
            stock: {}, // Dynamic lookup structure matching keys `Color||Size||Purity`
            purchaseLog: [],
            salesLog: [],
            rojmel: [],
            payments: [],
            adjEntries: [],
            auditTrail: [],
            invoiceCounters: { purchase: 1, sale: 1 },
            adminUsername: 'admin',
            adminPassword: 'admin123',
            editPassword: 'edit123',
            priceEditingUnlocked: false,
            isLoggedIn: false,
            autoLogoutHours: 12,
            rateDeviationMode: 'percentage',
            rateDeviationVal: 10,
            // Assortment state properties
            assortRecords: [],
            assortLearningMatrix: {},
            assortStaff: [],
            assortLostFound: [],
            // Manual local backups properties
            manualBackups: [],
            lastManualBackupTime: null,
            // Session tracking maps
            sessions: {}
        };

        // ── Admin Login ───────────────────────────────────────────────────
        // ── Admin Login ───────────────────────────────────────────────────
        function doAdminLogin() {
            const uInput = document.getElementById('login-username').value.trim();
            const pInput = document.getElementById('login-password').value;
            const errEl  = document.getElementById('admin-login-error');

            // Only allow stored credentials — no hardcoded fallback
            if (ERP_STATE.adminUsername === 'H') {
                ERP_STATE.adminUsername = 'admin';
                ERP_STATE.adminPassword = 'admin123';
                localStorage.removeItem('sms_admin_username');
                localStorage.removeItem('sms_admin_password');
            }

            // Only allow stored credentials — no hardcoded fallback
            const validUser = ERP_STATE.adminUsername;
            const validPass = ERP_STATE.adminPassword;
            if (!validUser || !validPass) {
                showCustomAlert("Error", "No credentials set. Please reload the page.", "error");
                return;
            }

            if (uInput === validUser && pInput === validPass) {
                ERP_STATE.isLoggedIn = true;
                ERP_STATE.loginTime = Date.now();
                
                // Save session in localStorage for local restoration on page refresh
                localStorage.setItem('sms_is_logged_in', 'true');
                localStorage.setItem('sms_login_time', ERP_STATE.loginTime.toString());
                localStorage.setItem('sms_auto_logout_duration', ERP_STATE.autoLogoutHours.toString());

                saveDatabaseState();

                document.getElementById('admin-login-overlay').style.display = 'none';
                // Populate profile fields
                const uEl = document.getElementById('profile-username');
                if (uEl) uEl.value = ERP_STATE.adminUsername;
                const editPassEl = document.getElementById('profile-edit-password');
                if (editPassEl) editPassEl.value = ERP_STATE.editPassword;
                // Switch view to blank default view
                switchView('view-blank');
                errEl.innerText = '';
            } else {
                const usernameValid = (uInput === validUser);
                if (!usernameValid) {
                    showCustomAlert("Error", "Username wrong", "error", function() {
                        const el = document.getElementById('login-username');
                        if (el) el.focus();
                    });
                } else {
                    showCustomAlert("Error", "Password wrong", "error", function() {
                        const el = document.getElementById('login-password');
                        if (el) el.focus();
                    });
                }
                document.getElementById('login-password').value = '';
            }
        }

        function updateLogoutHoursSetting(val) {
            let hours = parseFloat(val);
            if (isNaN(hours) || hours < 1) {
                hours = 1;
            } else if (hours > 168) {
                hours = 168;
            }
            
            ERP_STATE.autoLogoutHours = hours;
            saveDatabaseState();
            
            const logoutHoursInput = document.getElementById('profile-logout-hours');
            if (logoutHoursInput) logoutHoursInput.value = hours;
            
            showCustomAlert("Settings Updated", `Session logout time set to ${hours} hours.`, "success");
        }

        function updateDeviationModeSetting(val) {
            ERP_STATE.rateDeviationMode = val;
            saveDatabaseState();
            
            const unitLbl = document.getElementById('deviation-unit-lbl');
            if (unitLbl) {
                unitLbl.innerText = val === 'amount' ? '₹ difference allowed' : '% deviation allowed';
            }
            showCustomAlert("Settings Updated", `Rate deviation mode set to ${val === 'amount' ? 'Amount (₹)' : 'Percentage (%)'}.`, "success");
        }

        function updateDeviationValueSetting(val) {
            let threshold = parseFloat(val);
            if (isNaN(threshold) || threshold < 0) {
                threshold = 0;
            }
            
            ERP_STATE.rateDeviationVal = threshold;
            saveDatabaseState();
            
            const deviationInput = document.getElementById('profile-deviation-val');
            if (deviationInput) deviationInput.value = threshold;
            
            showCustomAlert("Settings Updated", `Rate deviation threshold set to ${threshold}${ERP_STATE.rateDeviationMode === 'amount' ? ' ₹' : '%'}.`, "success");
        }

        function resetAdminToDefault() {
            showCustomConfirm('Reset Credentials', 'This will reset admin credentials to default (admin / admin123). Proceed?', () => {
                ERP_STATE.adminUsername = 'admin';
                ERP_STATE.adminPassword = 'admin123';
                localStorage.setItem('sms_admin_username', 'admin');
                localStorage.setItem('sms_admin_password', 'admin123');
                saveDatabaseState();
                document.getElementById('login-username').value = 'admin';
                document.getElementById('login-password').value = 'admin123';
                showCustomAlert("Reset Done", "Username: admin / Password: admin123. Click SIGN IN.", "success");
            }, null, 'warning');
        }

        // ── Password eye-toggle (shared) ──────────────────────────────────
        function togglePassVis(inputId, btn) {
            const inp = document.getElementById(inputId);
            if (!inp) return;
            if (inp.type === 'password') {
                inp.type = 'text';
                btn.innerText = '🙈';
            } else {
                inp.type = 'password';
                btn.innerText = '👁️';
            }
        }

        // ── Update admin credentials from profile ─────────────────────────
        function updateAdminCredentials() {
            const oldPass = document.getElementById('profile-old-password').value;
            const newPass = document.getElementById('profile-new-password').value.trim();
            const conPass = document.getElementById('profile-confirm-password').value.trim();
            const newUser = document.getElementById('profile-username').value.trim();

            if (oldPass !== ERP_STATE.adminPassword) {
                showCustomAlert("Error", "❌ Current password is incorrect.", "error");
                return;
            }
            if (!newUser) {
                showCustomAlert("Error", "Username cannot be empty.", "warning");
                return;
            }
            if (newPass && newPass !== conPass) {
                showCustomAlert("Error", "❌ New passwords do not match.", "error");
                return;
            }
            ERP_STATE.adminUsername = newUser;
            if (newPass) {
                ERP_STATE.adminPassword = newPass;
            }
            localStorage.removeItem('sms_admin_username');
            localStorage.removeItem('sms_admin_password');
            localStorage.setItem('sms_admin_username', ERP_STATE.adminUsername);
            localStorage.setItem('sms_admin_password', ERP_STATE.adminPassword);
            saveDatabaseState();

            // Clear fields
            document.getElementById('profile-old-password').value = '';
            document.getElementById('profile-new-password').value = '';
            document.getElementById('profile-confirm-password').value = '';
            showCustomAlert("Success", "✅ Credentials updated successfully!", "success");
        }

        function updateEditPasswordSetting() {
            const editPass = document.getElementById('profile-edit-password').value.trim();
            ERP_STATE.editPassword = editPass;
            saveDatabaseState();
            showCustomAlert("Success", "✅ Security and Invoice Edit password updated successfully!", "success");
        }

        function saveSecurityRulesSettings() {
            // 1. Edit Password
            const editPass = document.getElementById('profile-edit-password').value.trim();
            ERP_STATE.editPassword = editPass;

            // 2. Logout Hours
            const logoutHoursVal = document.getElementById('profile-logout-hours').value;
            let hours = parseFloat(logoutHoursVal);
            if (isNaN(hours) || hours < 1) hours = 1;
            else if (hours > 168) hours = 168;
            ERP_STATE.autoLogoutHours = hours;
            document.getElementById('profile-logout-hours').value = hours;

            // 3. Rate Deviation Warning Mode & Value
            const mode = document.getElementById('profile-deviation-mode').value;
            const deviationVal = parseFloat(document.getElementById('profile-deviation-val').value);
            let threshold = isNaN(deviationVal) || deviationVal < 0 ? 0 : deviationVal;
            
            ERP_STATE.rateDeviationMode = mode;
            ERP_STATE.rateDeviationVal = threshold;
            saveDatabaseState();
            document.getElementById('profile-deviation-val').value = threshold;

            const unitLbl = document.getElementById('deviation-unit-lbl');
            if (unitLbl) {
                unitLbl.innerText = mode === 'amount' ? '₹ difference allowed' : '% deviation allowed';
            }

            showCustomAlert("Success", "✅ Security and price rules updated successfully!", "success");
        }

        function setupNumericInput(inputId, isDecimal, step, type) {
            const input = document.getElementById(inputId);
            if (!input) return;

            // Handle keyboard arrow keys
            input.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    let val = parseFloat(input.value) || 0;
                    val = Math.max(0, val + step);
                    input.value = isDecimal ? val.toFixed(2) : Math.round(val);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    updateInvoiceTotals(type);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    let val = parseFloat(input.value) || 0;
                    val = Math.max(0, val - step);
                    input.value = isDecimal ? val.toFixed(2) : Math.round(val);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    updateInvoiceTotals(type);
                }
            });

            // Prevent typing characters other than digits and optional dot
            input.addEventListener('keypress', (e) => {
                if (e.key.length > 1) return;
                if (e.key >= '0' && e.key <= '9') return;
                if (isDecimal && e.key === '.') {
                    if (!input.value.includes('.')) {
                        return;
                    }
                }
                e.preventDefault();
            });

            // Handle paste or invalid inputs
            input.addEventListener('input', (e) => {
                let val = input.value;
                if (isDecimal) {
                    if (val.startsWith('.')) {
                        val = '0' + val;
                    }
                    val = val.replace(/[^0-9.]/g, '');
                    const parts = val.split('.');
                    if (parts.length > 2) {
                        val = parts[0] + '.' + parts.slice(1).join('');
                    }
                } else {
                    val = val.replace(/[^0-9]/g, '');
                }
                if (input.value !== val) {
                    input.value = val;
                }
            });

            // Handle blur formatting
            input.addEventListener('blur', () => {
                let raw = input.value.trim();
                if (raw === "") {
                    input.value = "";
                } else {
                    let val = parseFloat(raw);
                    if (isNaN(val) || val < 0) {
                        input.value = "";
                    } else {
                        input.value = isDecimal ? val.toFixed(2) : Math.round(val);
                    }
                }
                updateInvoiceTotals(type);
            });
        }

        document.addEventListener('DOMContentLoaded', () => {
            // Seed initial transactional elements for full presentation view
            initializeBaseDatabaseState();
            loadDatabaseState(); // This loads all local storage variables synchronously and does normalization

            // Check session expiration on page load
            if (ERP_STATE.isLoggedIn && ERP_STATE.loginTime) {
                const currentTime = Date.now();
                const sessionMs = ERP_STATE.autoLogoutHours * 60 * 60 * 1000;
                if (currentTime - ERP_STATE.loginTime >= sessionMs) {
                    ERP_STATE.isLoggedIn = false;
                    ERP_STATE.loginTime = null;
                    localStorage.removeItem('sms_is_logged_in');
                    localStorage.removeItem('sms_login_time');
                    localStorage.removeItem('sms_user_email');
                }
            }

            if (ERP_STATE.isLoggedIn) {
                const loginOverlay = document.getElementById('admin-login-overlay');
                if (loginOverlay) loginOverlay.style.display = 'none';
                switchView('view-blank');
            } else {
                const usernameEl = document.getElementById('login-username');
                if (usernameEl) {
                    setTimeout(() => { usernameEl.focus(); }, 100);
                }
            }

            setupNumericInput('pur-form-days', false, 1, 'pur');
            setupNumericInput('pur-form-broker-pct', true, 0.05, 'pur');
            setupNumericInput('sale-form-days', false, 1, 'sale');
            setupNumericInput('sale-form-broker-pct', true, 0.05, 'sale');

            // Initialize backups rendering and reminder banner checks
            renderBackupHistory();
            updateBackupReminderUI();

            // Initialize opening date input with today's date
            const openingDateInput = document.getElementById('opening-date');
            if (openingDateInput) {
                openingDateInput.value = new Date().toISOString().split('T')[0];
            }

            // Initialize payment voucher date with today's date
            const paymentDateInput = document.getElementById('payment-voucher-date');
            if (paymentDateInput) {
                paymentDateInput.value = new Date().toISOString().split('T')[0];
            }

            // Initialize assortment timestamps
            setAssortFormTimestamps();
            const lfDateInput = document.getElementById('assort-lfDate');
            if (lfDateInput) lfDateInput.value = new Date().toISOString().split('T')[0];

            // Set running timer loop for floor active jobs
            setInterval(() => {
                document.querySelectorAll('[data-assort-timer]').forEach(el => {
                    const timeIssued = el.getAttribute('data-assort-timer');
                    el.innerText = getElapsedString(timeIssued);
                });
            }, 30000);

            // Pre-initialize default view layout and sidebar options
            switchView('view-blank');
            updateLiveStatusClock();

            // Initialize the logout hours input field
            const logoutHoursInput = document.getElementById('profile-logout-hours');
            if (logoutHoursInput) {
                logoutHoursInput.value = ERP_STATE.autoLogoutHours;
            }

            // Initialize the rate deviation threshold input field and mode
            const deviationModeSelect = document.getElementById('profile-deviation-mode');
            if (deviationModeSelect) {
                deviationModeSelect.value = ERP_STATE.rateDeviationMode || 'percentage';
            }
            const deviationInput = document.getElementById('profile-deviation-val');
            if (deviationInput) {
                deviationInput.value = ERP_STATE.rateDeviationVal !== undefined ? ERP_STATE.rateDeviationVal : 10;
            }
            const unitLbl = document.getElementById('deviation-unit-lbl');
            if (unitLbl) {
                unitLbl.innerText = ERP_STATE.rateDeviationMode === 'amount' ? '₹ difference allowed' : '% deviation allowed';
            }

            // Refresh components on startup
            refreshAllMasterSelectors();
            actionAddNew('pur');
            actionAddNew('sale');
            renderAllDataComponents();
            renderBackupHistory();
            updateBackupReminderUI();

            // Check session expiration every 10 seconds
            setInterval(() => {
                if (ERP_STATE.isLoggedIn) {
                    const loginTime = ERP_STATE.loginTime;
                    if (loginTime) {
                        const currentTime = Date.now();
                        const sessionMs = ERP_STATE.autoLogoutHours * 60 * 60 * 1000;
                        if (currentTime - loginTime >= sessionMs) {
                            showCustomAlert("Session Expired", `🔒 Your ${ERP_STATE.autoLogoutHours}-hour login session has expired. You will be logged out automatically.`, "warning");
                            doAdminLogout();
                        }
                    } else {
                        doAdminLogout();
                    }
                }
            }, 10000);

            // Connect and initialize Firebase real-time database sync
            initializeFirebase();
        });

        function getStockKey(color, size, clarity) {
            const c = (color || "").toString().trim().toUpperCase();
            const s = (size || "").toString().trim().toUpperCase();
            const cl = (clarity || "").toString().trim().toUpperCase();
            return `${c}||${s}||${cl}`;
        }

        function normalizeDatabaseState(shouldSave = true) {
            // 1. Normalize logs
            if (Array.isArray(ERP_STATE.purchaseLog)) {
                ERP_STATE.purchaseLog.forEach(item => {
                    if (item.color) item.color = item.color.toString().trim().toUpperCase();
                    if (item.size) item.size = item.size.toString().trim().toUpperCase();
                    if (item.clarity) item.clarity = item.clarity.toString().trim().toUpperCase();
                });
            }
            if (Array.isArray(ERP_STATE.salesLog)) {
                ERP_STATE.salesLog.forEach(item => {
                    if (item.color) item.color = item.color.toString().trim().toUpperCase();
                    if (item.size) item.size = item.size.toString().trim().toUpperCase();
                    if (item.clarity) item.clarity = item.clarity.toString().trim().toUpperCase();
                });
            }

            // 1b. Normalize payments
            if (Array.isArray(ERP_STATE.payments)) {
                ERP_STATE.payments.forEach(item => {
                    if (item.party) item.party = item.party.toString().trim().toUpperCase();
                });
            }

            // 1c. Normalize adjEntries
            if (Array.isArray(ERP_STATE.adjEntries)) {
                ERP_STATE.adjEntries.forEach(item => {
                    if (item.description) item.description = item.description.toString().trim();
                });
            }

            // 1d. Ensure auditTrail is an array
            if (!Array.isArray(ERP_STATE.auditTrail)) ERP_STATE.auditTrail = [];

            // 2. Normalize masters lists
            if (ERP_STATE.masters) {
                const keys = ['colors', 'sizes', 'numbers', 'purities', 'seriesPurities', 'parties', 'brokers'];
                keys.forEach(k => {
                    if (Array.isArray(ERP_STATE.masters[k])) {
                        ERP_STATE.masters[k] = ERP_STATE.masters[k]
                            .map(x => (x || "").toString().trim().toUpperCase())
                            .filter((val, idx, self) => val !== "" && self.indexOf(val) === idx);
                    }
                });
            }

            // 3. Normalize stock keys and sum/merge values
            if (ERP_STATE.stock) {
                const normalizedStock = {};
                for (const [key, val] of Object.entries(ERP_STATE.stock)) {
                    const parts = key.split('||');
                    if (parts.length === 3) {
                        const normKey = getStockKey(parts[0], parts[1], parts[2]);
                        normalizedStock[normKey] = (normalizedStock[normKey] || 0) + val;
                    } else {
                        normalizedStock[key.trim().toUpperCase()] = val;
                    }
                }
                ERP_STATE.stock = normalizedStock;
            }

            // 4. Save normalized database
            if (shouldSave) {
                saveDatabaseState();
            }
        }

        function saveDatabaseState() {
            try {
                localStorage.setItem('sms_stock', JSON.stringify(ERP_STATE.stock || {}));
                localStorage.setItem('sms_purchaseLog', JSON.stringify(ERP_STATE.purchaseLog || []));
                localStorage.setItem('sms_salesLog', JSON.stringify(ERP_STATE.salesLog || []));
                localStorage.setItem('sms_rojmel', JSON.stringify(ERP_STATE.rojmel || []));
                localStorage.setItem('sms_payments', JSON.stringify(ERP_STATE.payments || []));
                localStorage.setItem('sms_adjEntries', JSON.stringify(ERP_STATE.adjEntries || []));
                localStorage.setItem('sms_auditTrail', JSON.stringify(ERP_STATE.auditTrail || []));
                localStorage.setItem('sms_invoiceCounters', JSON.stringify(ERP_STATE.invoiceCounters || { purchase: 1, sale: 1 }));
                localStorage.setItem('sms_masters', JSON.stringify(ERP_STATE.masters || {}));
                localStorage.setItem('sms_invoiceMetadata', JSON.stringify(ERP_STATE.invoiceMetadata || {}));
                
                localStorage.setItem('sms_assortRecords', JSON.stringify(ERP_STATE.assortRecords || []));
                localStorage.setItem('sms_learningMatrix', JSON.stringify(ERP_STATE.assortLearningMatrix || {}));
                localStorage.setItem('sms_assortStaff', JSON.stringify(ERP_STATE.assortStaff || []));
                localStorage.setItem('sms_assortLostFound', JSON.stringify(ERP_STATE.assortLostFound || []));
                
                localStorage.setItem('sms_manualBackups', JSON.stringify(ERP_STATE.manualBackups || []));
                localStorage.setItem('sms_lastBackupTime', ERP_STATE.lastManualBackupTime || '');

                localStorage.setItem('sms_admin_username', ERP_STATE.adminUsername || 'admin');
                localStorage.setItem('sms_admin_password', ERP_STATE.adminPassword || 'admin123');
                localStorage.setItem('sms_edit_password', ERP_STATE.editPassword || 'edit123');
                localStorage.setItem('sms_auto_logout_duration', (ERP_STATE.autoLogoutHours || 12).toString());
                localStorage.setItem('sms_rate_deviation_mode', ERP_STATE.rateDeviationMode || 'percentage');
                localStorage.setItem('sms_rate_deviation_val', (ERP_STATE.rateDeviationVal !== undefined ? ERP_STATE.rateDeviationVal : 10).toString());
                localStorage.setItem('sms_settings_shortcuts', JSON.stringify(ERP_STATE.shortcuts || {}));
                
                localStorage.setItem('sms_notepad_text', ERP_STATE.notepadText || '');
                localStorage.setItem('sms_last_bhav', JSON.stringify(ERP_STATE.lastBhav || {}));
                
                localStorage.setItem('sms_is_logged_in', ERP_STATE.isLoggedIn ? 'true' : 'false');
                localStorage.setItem('sms_login_time', (ERP_STATE.loginTime || '').toString());

                // Sync updates asynchronously to Firebase Realtime Database
                pushStateToFirebase();
            } catch (e) {
                console.error("Local save failed", e);
            }
        }



        function rebuildStockFromLogs() {
            challengeAdminPassword(() => {
                showCustomConfirm('Recalculate Stock', 'Are you sure you want to rebuild and recalculate the stock balance strictly from transaction logs?', () => {
                    const newStock = {};

                    // 1. Process all purchases (adds to stock)
                    const purchases = ERP_STATE.purchaseLog || [];
                    purchases.forEach(p => {
                        const key = getStockKey(p.color, p.size, p.clarity);
                        newStock[key] = (newStock[key] || 0) + p.carats;
                    });

                    // 2. Process all sales (subtracts from stock)
                    const sales = ERP_STATE.salesLog || [];
                    sales.forEach(s => {
                        const key = getStockKey(s.color, s.size, s.clarity);
                        newStock[key] = (newStock[key] || 0) - s.carats;
                    });

                    // 3. Remove zero/near-zero balances
                    for (const [key, qty] of Object.entries(newStock)) {
                        if (Math.abs(qty) < 0.0001) {
                            delete newStock[key];
                        }
                    }

                    // 4. Save and apply
                    ERP_STATE.stock = newStock;
                    saveDatabaseState();
                    renderAllDataComponents();
                    showCustomAlert("Stock Recalculated", "Stock balances successfully recalculated and synchronized with purchase/sales log entries.", "success");
                });
            }, "Enter administrative password to recalculate stock:");
        }

        function saveInvoiceCountersSetting() {
            const purVal = parseInt(document.getElementById('settings-purchase-counter').value) || 1;
            const saleVal = parseInt(document.getElementById('settings-sales-counter').value) || 1;

            if (purVal < 1 || saleVal < 1) {
                showCustomAlert("Validation Error", "Invoice counters must be greater than or equal to 1.", "warning");
                return;
            }

            challengeAdminPassword(() => {
                ERP_STATE.invoiceCounters.purchase = purVal;
                ERP_STATE.invoiceCounters.sale = saleVal;
                saveDatabaseState();
                showCustomAlert("Success", `Invoice counters updated! Next Purchase Invoice No: P${purVal}, Next Sales Invoice No: S${saleVal}.`, "success");
            }, "Enter administrative password to update invoice counters:");
        }

        function clearEntireDatabase() {
            challengeAdminPassword(() => {
                showCustomConfirm('⚠️ WIPE ENTIRE DATABASE', 'This will permanently delete ALL saved data including stock, purchase/sale logs, rojmel, masters, assortment records, backups, and settings.\n\nThis action is IRREVERSIBLE. Are you absolutely sure?', () => {
                    // Reset ERP_STATE to baseline empty structures
                    ERP_STATE.stock = {};
                    ERP_STATE.purchaseLog = [];
                    ERP_STATE.salesLog = [];
                    ERP_STATE.rojmel = [];
                    ERP_STATE.invoiceCounters = { purchase: 1, sale: 1 };
                    ERP_STATE.invoiceMetadata = {};
                    ERP_STATE.masters = {
                        colors: ['White', 'BLC', 'Fancy Group'],
                        sizes: ['-2', '+2', 'MIX'],
                        numbers: ['WH 1 VVS', 'WH 1 VS SI', 'Wh vs colour', 'WH 2', 'NW 1', 'NW 2', 'ow1 better', 'OW 1', 'ttlb', 'dark lb', 'Wh 3', 'RIPER', 'table chari', 'Lc fancy'],
                        purities: ['WH 1 VVS', 'WH 1 VS SI', 'Wh vs colour', 'WH 2', 'NW 1', 'NW 2', 'ow1 better', 'OW 1', 'ttlb', 'dark lb', 'Wh 3', 'RIPER', 'table chari', 'Lc fancy'],
                        parties: [],
                        brokers: [],
                        seriesPurities: ['WH 1 VVS', 'WH 1 VS SI', 'Wh vs colour', 'WH 2', 'NW 1', 'NW 2', 'ow1 better', 'OW 1', 'ttlb', 'dark lb', 'Wh 3', 'RIPER', 'table chari', 'Lc fancy']
                    };
                    ERP_STATE.assortRecords = [];
                    ERP_STATE.assortLearningMatrix = {};
                    ERP_STATE.assortStaff = [];
                    ERP_STATE.assortLostFound = [];
                    ERP_STATE.payments = [];
                    ERP_STATE.adjEntries = [];
                    ERP_STATE.auditTrail = [];
                    ERP_STATE.manualBackups = [];
                    ERP_STATE.lastManualBackupTime = null;
                    ERP_STATE.adminUsername = 'admin';
                    ERP_STATE.adminPassword = 'admin123';
                    ERP_STATE.editPassword = 'edit123';
                    ERP_STATE.autoLogoutHours = 12;
                    ERP_STATE.rateDeviationMode = 'percentage';
                    ERP_STATE.rateDeviationVal = 10;
                    ERP_STATE.notepadText = "";
                    ERP_STATE.lastBhav = {};
                    ERP_STATE.sessions = {};

                    // Wipe local storage database and reload page
                    saveDatabaseState();
                    location.reload();
                }, null, 'danger');
            }, "Enter administrative password to authorize database wipe:");
        }

        function loadDatabaseState() {
            try {
                const stock = localStorage.getItem('sms_stock');
                if (stock) ERP_STATE.stock = JSON.parse(stock);
                const purLog = localStorage.getItem('sms_purchaseLog');
                if (purLog) ERP_STATE.purchaseLog = JSON.parse(purLog);
                const salesLog = localStorage.getItem('sms_salesLog');
                if (salesLog) ERP_STATE.salesLog = JSON.parse(salesLog);
                const rojmel = localStorage.getItem('sms_rojmel');
                if (rojmel) ERP_STATE.rojmel = JSON.parse(rojmel);
                const payments = localStorage.getItem('sms_payments');
                if (payments) ERP_STATE.payments = JSON.parse(payments);
                const adjEntries = localStorage.getItem('sms_adjEntries');
                if (adjEntries) ERP_STATE.adjEntries = JSON.parse(adjEntries);
                const auditTrail = localStorage.getItem('sms_auditTrail');
                if (auditTrail) ERP_STATE.auditTrail = JSON.parse(auditTrail);
                const counters = localStorage.getItem('sms_invoiceCounters');
                if (counters) ERP_STATE.invoiceCounters = JSON.parse(counters);
                const masters = localStorage.getItem('sms_masters');
                if (masters) ERP_STATE.masters = JSON.parse(masters);
                const invoiceMetadata = localStorage.getItem('sms_invoiceMetadata');
                if (invoiceMetadata) {
                    ERP_STATE.invoiceMetadata = JSON.parse(invoiceMetadata);
                } else {
                    ERP_STATE.invoiceMetadata = {};
                }

                const assort = localStorage.getItem('sms_assortRecords');
                if (assort) ERP_STATE.assortRecords = JSON.parse(assort);
                const matrix = localStorage.getItem('sms_learningMatrix');
                if (matrix) ERP_STATE.assortLearningMatrix = JSON.parse(matrix);
                const staff = localStorage.getItem('sms_assortStaff');
                if (staff) ERP_STATE.assortStaff = JSON.parse(staff);
                const lf = localStorage.getItem('sms_assortLostFound');
                if (lf) ERP_STATE.assortLostFound = JSON.parse(lf);

                const backups = localStorage.getItem('sms_manualBackups');
                if (backups) ERP_STATE.manualBackups = JSON.parse(backups);
                const lbt = localStorage.getItem('sms_lastBackupTime');
                if (lbt) ERP_STATE.lastManualBackupTime = lbt;

                const user = localStorage.getItem('sms_admin_username');
                if (user) ERP_STATE.adminUsername = user;
                const pass = localStorage.getItem('sms_admin_password');
                if (pass) ERP_STATE.adminPassword = pass;
                const epass = localStorage.getItem('sms_edit_password');
                if (epass) ERP_STATE.editPassword = epass;
                const dur = localStorage.getItem('sms_auto_logout_duration');
                if (dur) ERP_STATE.autoLogoutHours = parseFloat(dur);
                const mode = localStorage.getItem('sms_rate_deviation_mode');
                if (mode) ERP_STATE.rateDeviationMode = mode;
                const val = localStorage.getItem('sms_rate_deviation_val');
                if (val) ERP_STATE.rateDeviationVal = parseFloat(val);

                const loggedIn = localStorage.getItem('sms_is_logged_in');
                if (loggedIn) ERP_STATE.isLoggedIn = (loggedIn === 'true');
                const logTime = localStorage.getItem('sms_login_time');
                if (logTime) ERP_STATE.loginTime = parseInt(logTime, 10);
                const userEmail = localStorage.getItem('sms_user_email');
                if (userEmail) ERP_STATE.currentUserEmail = userEmail;

                const notepadText = localStorage.getItem('sms_notepad_text');
                if (notepadText) ERP_STATE.notepadText = notepadText;
                const lastBhav = localStorage.getItem('sms_last_bhav');
                if (lastBhav) ERP_STATE.lastBhav = JSON.parse(lastBhav);

                const DEFAULT_SHORTCUTS = {
                    "Add New": { key: "n", altKey: true, ctrlKey: false, shiftKey: false, display: "Alt+N", active: true },
                    "Save Invoice": { key: "s", altKey: true, ctrlKey: false, shiftKey: false, display: "Alt+S", active: true },
                    "Open P PURCHASE": { key: "f1", altKey: false, ctrlKey: false, shiftKey: false, display: "F1", active: true, view: "view-purchase" },
                    "Open P SELL": { key: "f2", altKey: false, ctrlKey: false, shiftKey: false, display: "F2", active: true, view: "view-sale" },
                    "Open TIJORI": { key: "f3", altKey: false, ctrlKey: false, shiftKey: false, display: "F3", active: true, view: "view-stock" },
                    "Open SERIES OPENING": { key: "f4", altKey: false, ctrlKey: false, shiftKey: false, display: "F4", active: true, view: "view-opening" },
                    "Open ASSORTMENT": { key: "f5", altKey: false, ctrlKey: false, shiftKey: false, display: "F5", active: true, view: "view-assortment" },
                    "Open MIX TRANSFER": { key: "f6", altKey: false, ctrlKey: false, shiftKey: false, display: "F6", active: true, view: "view-mix" },
                    "Open PAYMENT ENTRY": { key: "f7", altKey: false, ctrlKey: false, shiftKey: false, display: "F7", active: true, view: "view-payment-entry" },
                    "Open PAYMENT IR": { key: "f8", altKey: false, ctrlKey: false, shiftKey: false, display: "F8", active: true, view: "view-payment-ir" },
                    "Open ROJMEL LEDGER": { key: "f9", altKey: false, ctrlKey: false, shiftKey: false, display: "F9", active: true, view: "view-rojmel" },
                    "Open REPORT MASTER": { key: "f10", altKey: false, ctrlKey: false, shiftKey: false, display: "F10", active: true, view: "view-reports" },
                    "Open WHATSAPP": { key: "f11", altKey: false, ctrlKey: false, shiftKey: false, display: "F11", active: true, view: "view-whatsapp" },
                    "Open SHADE MASTER": { key: "", altKey: false, ctrlKey: false, shiftKey: false, display: "", active: true, view: "view-purity-master" },
                    "Open NUMBER MASTER": { key: "", altKey: false, ctrlKey: false, shiftKey: false, display: "", active: true, view: "view-number-master" },
                    "Open SIZE MASTER": { key: "", altKey: false, ctrlKey: false, shiftKey: false, display: "", active: true, view: "view-size-master" },
                    "Open PARTY MASTER": { key: "", altKey: false, ctrlKey: false, shiftKey: false, display: "", active: true, view: "view-party-master" },
                    "Open BROKER MASTER": { key: "", altKey: false, ctrlKey: false, shiftKey: false, display: "", active: true, view: "view-broker-master" },
                    "Open SETTINGS": { key: "", altKey: false, ctrlKey: false, shiftKey: false, display: "", active: true, view: "view-settings" }
                };
                const savedShortcuts = localStorage.getItem('sms_settings_shortcuts');
                if (savedShortcuts) {
                    try {
                        const parsed = JSON.parse(savedShortcuts);
                        const cleanParsed = {};
                        for (const [key, val] of Object.entries(parsed)) {
                            let cleanKey = key;
                            if (cleanKey.includes('.') || cleanKey.includes('/')) {
                                cleanKey = cleanKey.replace(/\./g, ' ').replace(/\//g, ' ');
                            }
                            cleanParsed[cleanKey] = val;
                        }
                        ERP_STATE.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS, cleanParsed);
                    } catch (e) {
                        ERP_STATE.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS);
                    }
                } else {
                    ERP_STATE.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS);
                }

                // Run database normalization locally on load database state
                normalizeDatabaseState(false);
            } catch (e) {
                console.error("Failed to load database state", e);
            }
        }

        function initializeBaseDatabaseState() {
            // Initialize with completely clean state for fresh production use
            ERP_STATE.stock = {};
            ERP_STATE.purchaseLog = [];
            ERP_STATE.salesLog = [];
            ERP_STATE.rojmel = [];
            ERP_STATE.payments = [];
            ERP_STATE.adjEntries = [];
            ERP_STATE.auditTrail = [];
            // Clean assortment state
            ERP_STATE.assortRecords = [];
            ERP_STATE.assortLearningMatrix = {};
            ERP_STATE.assortStaff = [];
            ERP_STATE.assortLostFound = [];
            // Clean backups state
            ERP_STATE.manualBackups = [];
            ERP_STATE.lastManualBackupTime = null;
        }

        // View Router Controller
        // View Router Controller
        function switchView(viewId) {
            document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active-view'));
            
            const viewEl = document.getElementById(viewId);
            if (viewEl) viewEl.classList.add('active-view');
            
            // Find which top tab and option matches this viewId
            let targetTab = '';
            let optText = '';

            const viewMapping = {
                'view-purchase': { tab: 'polish-entry', optText: 'P.PURCHASE' },
                'view-sale': { tab: 'polish-entry', optText: 'P.SELL' },
                'view-assortment': { tab: 'polish-entry', optText: 'ASSORTMENT' },
                'view-payment-ir': { tab: 'accounts', optText: 'PAYMENT I/R' },
                'view-payment-entry': { tab: 'accounts', optText: 'PAYMENT ENTRY' },
                'view-mix': { tab: 'polish-entry', optText: 'MIX TRANSFER' },
                'view-stock': { tab: 'polish-entry', optText: 'TIJORI' },
                'view-rojmel': { tab: 'accounts', optText: 'ROJMEL/LEDGER' },
                'view-reports': { tab: 'polish-reports', optText: 'REPORT MASTER' },
                'view-reports-log': { tab: 'polish-reports', optText: 'TRANSACTION LOG' },
                'view-whatsapp': { tab: 'polish-reports', optText: 'WHATSAPP' },
                'view-purity-master': { tab: 'param-master', optText: 'SHADE MASTER' },
                'view-number-master': { tab: 'param-master', optText: 'NUMBER MASTER' },
                'view-size-master': { tab: 'param-master', optText: 'SIZE MASTER' },
                'view-party-master': { tab: 'masters', optText: 'PARTY MASTER' },
                'view-broker-master': { tab: 'masters', optText: 'BROKER MASTER' },
                'view-opening': { tab: 'polish-entry', optText: 'SERIES OPENING' },
                'view-settings': { tab: 'utility', optText: 'SETTINGS' },
                'view-blank': { tab: 'blank', optText: '' }
            };

            const mapping = viewMapping[viewId];
            if (mapping) {
                // Highlight top tab
                document.querySelectorAll('.menu-tab').forEach(t => t.classList.remove('active'));
                const tabEl = document.getElementById('tab-' + mapping.tab);
                if (tabEl) tabEl.classList.add('active');

                // Populate and highlight sidebar option list
                renderSidebarOptions(mapping.tab, mapping.optText);
            }

            if (viewId === 'view-settings') {
                renderShortcutsTable();
                
                // Populate invoice counters inputs
                const purCounter = document.getElementById('settings-purchase-counter');
                const saleCounter = document.getElementById('settings-sales-counter');
                if (purCounter) purCounter.value = ERP_STATE.invoiceCounters.purchase || 1;
                if (saleCounter) saleCounter.value = ERP_STATE.invoiceCounters.sale || 1;
            }
            if (viewId === 'view-rojmel') {
                renderRojmelTable();
            }
            if (viewId === 'view-reports-log') {
                switchAuditTab('PURCHASE');
            }
            if (viewId === 'view-payment-entry') {
                updatePaymentPartyBalanceDisplay();
                const dtField = document.getElementById('payment-voucher-date');
                if (dtField) dtField.focus();
            }
            if (viewId === 'view-whatsapp') {
                updateWhatsAppPreview();
            }
            if (viewId === 'view-blank') {
                updateAnalyticsCharts();
            }

            // Focus date field for purchase/sale views only if logged in
            if (ERP_STATE.isLoggedIn && (viewId === 'view-purchase' || viewId === 'view-sale')) {
                const type = viewId === 'view-purchase' ? 'pur' : 'sale';
                const dtField = document.getElementById(`${type}-form-date`);
                if (dtField) dtField.focus();
            }
        }

        function renderSidebarOptions(tabId, activeOptText) {
            const listEl = document.getElementById('sidebar-option-list');
            if (!listEl) return;

            const tabOptions = {
                'polish-entry': [
                    { label: 'P.PURCHASE<br>(F1)', view: 'view-purchase', match: 'P.PURCHASE' },
                    { label: 'P.SELL<br>(F2)', view: 'view-sale', match: 'P.SELL' },
                    { label: 'TIJORI<br>(F3)', view: 'view-stock', match: 'TIJORI' },
                    { label: 'SERIES OPENING<br>(F4)', view: 'view-opening', match: 'SERIES OPENING' },
                    { label: 'ASSORTMENT<br>(F5)', view: 'view-assortment', match: 'ASSORTMENT' },
                    { label: 'MIX TRANSFER<br>(F6)', view: 'view-mix', match: 'MIX TRANSFER' }
                ],
                'accounts': [
                    { label: 'PAYMENT ENTRY<br>(F7)', view: 'view-payment-entry', match: 'PAYMENT ENTRY' },
                    { label: 'PAYMENT I/R<br>(F8)', view: 'view-payment-ir', match: 'PAYMENT I/R' },
                    { label: 'ROJMEL/LEDGER<br>(F9)', view: 'view-rojmel', match: 'ROJMEL/LEDGER' }
                ],
                'polish-reports': [
                    { label: 'REPORT MASTER<br>(F10)', view: 'view-reports', match: 'REPORT MASTER' },
                    { label: 'WHATSAPP<br>(F11)', view: 'view-whatsapp', match: 'WHATSAPP' },
                    { label: 'TRANSACTION LOG', view: 'view-reports-log', match: 'TRANSACTION LOG' }
                ],
                'param-master': [
                    { label: 'SHADE MASTER', view: 'view-purity-master', match: 'SHADE MASTER' },
                    { label: 'NUMBER MASTER', view: 'view-number-master', match: 'NUMBER MASTER' },
                    { label: 'SIZE MASTER', view: 'view-size-master', match: 'SIZE MASTER' }
                ],
                'masters': [
                    { label: 'PARTY MASTER', view: 'view-party-master', match: 'PARTY MASTER' },
                    { label: 'BROKER MASTER', view: 'view-broker-master', match: 'BROKER MASTER' }
                ],
                'utility': [
                    { label: 'SETTINGS', view: 'view-settings', match: 'SETTINGS' }
                ]
            };

            const opts = tabOptions[tabId] || [];
            let html = '';
            opts.forEach(o => {
                const isActive = activeOptText && o.match.toUpperCase() === activeOptText.toUpperCase();
                html += `<button class="sidebar-btn ${isActive ? 'active' : ''}" onclick="switchView('${o.view}')">${o.label}</button>`;
            });
            listEl.innerHTML = html;
        }

        function selectTopMenu(menuName) {
            const defaults = {
                'polish-entry': 'view-purchase',
                'accounts': 'view-payment-entry',
                'polish-reports': 'view-reports',
                'param-master': 'view-purity-master',
                'masters': 'view-party-master',
                'utility': 'view-settings'
            };
            const defaultView = defaults[menuName];
            if (defaultView) {
                switchView(defaultView);
            }
        }
        function doAdminLogout() {
            ERP_STATE.isLoggedIn = false;
            ERP_STATE.loginTime = null;
            ERP_STATE.currentUserEmail = null;
            
            // Clear session from localStorage
            localStorage.removeItem('sms_is_logged_in');
            localStorage.removeItem('sms_login_time');
            localStorage.removeItem('sms_user_email');
            

            document.getElementById('admin-login-overlay').style.display = 'flex';
            const usernameEl = document.getElementById('login-username');
            const passwordEl = document.getElementById('login-password');
            if (usernameEl) {
                usernameEl.value = '';
                setTimeout(() => { usernameEl.focus(); }, 100);
            }
            if (passwordEl) {
                passwordEl.value = '';
            }
        }

        // Floating tools toggles & actions
        function toggleNotepadTool() {
            const popup = document.getElementById('erp-notepad-popup');
            if (popup.style.display === 'none') {
                popup.style.display = 'flex';
                const saved = getStorageItem('sms_notepad_text') || '';
                document.getElementById('erp-notepad-text').value = saved;
                document.getElementById('erp-notepad-text').focus();
            } else {
                popup.style.display = 'none';
            }
        }
        function saveNotepadText() {
            const text = document.getElementById('erp-notepad-text').value;
            setStorageItem('sms_notepad_text', text);
        }
        
        let calcVal = '';
        function toggleCalcTool() {
            const popup = document.getElementById('erp-calc-popup');
            if (popup.style.display === 'none') {
                popup.style.display = 'flex';
                calcVal = '';
                document.getElementById('calc-screen').value = '0';
            } else {
                popup.style.display = 'none';
            }
        }
        function pressCalcKey(key) {
            const screen = document.getElementById('calc-screen');
            if (key === 'C') {
                calcVal = '';
                screen.value = '0';
            } else if (key === '=') {
                try {
                    const result = new Function(`return ${calcVal}`)();
                    screen.value = result;
                    calcVal = String(result);
                } catch(e) {
                    screen.value = 'Error';
                    calcVal = '';
                }
            } else {
                if (screen.value === '0' && key !== '.') {
                    calcVal = key;
                } else {
                    calcVal += key;
                }
                screen.value = calcVal;
            }
        }

        function updateLiveStatusClock() {
            const dateEl = document.getElementById('sidebar-date');
            const timeEl = document.getElementById('sidebar-time');
            if (!dateEl || !timeEl) return;

            const now = new Date();
            let hrs = now.getHours();
            const mins = String(now.getMinutes()).padStart(2, '0');
            const secs = String(now.getSeconds()).padStart(2, '0');
            const ampm = hrs >= 12 ? 'PM' : 'AM';
            hrs = hrs % 12;
            hrs = hrs ? hrs : 12; // hour '0' should be '12'
            const hrsStr = String(hrs).padStart(2, '0');
            timeEl.innerText = `${hrsStr}:${mins}:${secs} ${ampm}`;

            const day = String(now.getDate()).padStart(2, '0');
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const year = now.getFullYear();
            dateEl.innerText = `${day}/${month}/${year}`;
        }
        setInterval(updateLiveStatusClock, 1000);

        function toggleMasterSubmenu(event) {
            event.stopPropagation();
            const submenu = document.getElementById('master-submenu');
            const arrow = document.getElementById('master-arrow');
            const btn = document.getElementById('master-dropdown-btn');

            if (submenu.style.display === 'none' || !submenu.style.display) {
                submenu.style.display = 'block';
                arrow.style.transform = 'rotate(180deg)';
                btn.classList.add('active');
            } else {
                submenu.style.display = 'none';
                arrow.style.transform = 'rotate(0deg)';
                btn.classList.remove('active');
            }
        }

        function toggleSidebar() {
            document.body.classList.toggle('sidebar-collapsed');
            const btn = document.getElementById('sidebar-toggle-btn');
            if (btn) {
                btn.innerText = document.body.classList.contains('sidebar-collapsed') ? '▶' : '◀';
            }
        }

        // Dropdown Dynamic Synchronization Engine
        function refreshAllMasterSelectors() {
            const bindSelect = (id, list, placeholder, addOption) => {
                const el = document.getElementById(id);
                if (!el) return;
                if (el.tagName === 'SELECT') {
                    let html = "";
                    if (placeholder) {
                        html += `<option value="">${placeholder}</option>`;
                    }
                    if (addOption) {
                        html += `<option value="${addOption}" style="font-weight:bold; color:var(--success-color);">${addOption}</option>`;
                    }
                    html += list.map(item => `<option value="${item}">${item}</option>`).join('');
                    el.innerHTML = html;
                } else if (el.tagName === 'INPUT') {
                    if (el.value && !list.includes(el.value)) {
                        el.value = "";
                        el.dispatchEvent(new Event('change'));
                    }
                }
            };

            // Legacy IDs (to keep Mix transfer, etc. from breaking)
            bindSelect('pur-color', ERP_STATE.masters.colors, '-- Select Shade --');
            bindSelect('pur-size', ERP_STATE.masters.sizes, '-- Select Size --');
            bindSelect('pur-clarity', ERP_STATE.masters.numbers, '-- Select Purity --');
            bindSelect('pur-party', ERP_STATE.masters.parties, '-- Select Party --', '+ Add New Party');
            bindSelect('pur-broker', ERP_STATE.masters.brokers, '-- Select Broker --', '+ Add New Broker');
            bindSelect('sale-color', ERP_STATE.masters.colors, '-- Select Shade --');
            bindSelect('sale-size', ERP_STATE.masters.sizes, '-- Select Size --');
            bindSelect('sale-clarity', ERP_STATE.masters.numbers, '-- Select Purity --');
            bindSelect('sale-party', ERP_STATE.masters.parties, '-- Select Party --', '+ Add New Party');
            bindSelect('sale-broker', ERP_STATE.masters.brokers, '-- Select Broker --', '+ Add New Broker');

            // NEW split ERP form and sheet IDs (custom input-driven lookup fields and handled separately)

            // Opening Stock Series Wizard select inputs
            bindSelect('opening-source-purity', ERP_STATE.masters.numbers, '-- Select Source Purity --');
            const srcSelect = document.getElementById('opening-source-purity');
            if (srcSelect && !srcSelect.value) {
                srcSelect.value = "RIPER";
            }
            updateOpeningSourceStock();

            // Mix Engine Select inputs
            bindSelect('mix-src-color', ERP_STATE.masters.colors, '-- Select Shade --');
            bindSelect('mix-src-purity', ERP_STATE.masters.numbers, '-- Select Purity --');
            bindSelect('mix-dest-color', ERP_STATE.masters.colors, '-- Select Shade --');
            bindSelect('mix-dest-purity', ERP_STATE.masters.numbers, '-- Select Purity --');

            // Report Filter selectors
            bindSelect('filter-party', ERP_STATE.masters.parties, 'Select Party');
            bindSelect('filter-broker', ERP_STATE.masters.brokers, 'Select Broker');
            bindSelect('filter-size', ERP_STATE.masters.sizes, 'Select Size');
            bindSelect('filter-purity', ERP_STATE.masters.numbers, 'Select Purity');

            // Assortment Sieve size dropdown inputs
            bindSelect('assort-sieveSize', ERP_STATE.masters.sizes);
            bindSelect('assort-picker-manual-size', ERP_STATE.masters.sizes);
        }

        function updateMixSourceAvailable() {
            const colorEl = document.getElementById('mix-src-color');
            const sizeEl = document.getElementById('mix-src-size');
            const purityEl = document.getElementById('mix-src-purity');
            if (!colorEl || !sizeEl || !purityEl) return;

            const color = colorEl.value;
            const size = sizeEl.value;
            const purity = purityEl.value;
            const key = `${color}||${size}||${purity}`;
            const available = ERP_STATE.stock[key] || 0;
            document.getElementById('mix-src-available').innerText = `${available.toFixed(3)} Cts`;
        }

        function executeStockMix() {
            const srcColor = document.getElementById('mix-src-color').value;
            const srcSize = document.getElementById('mix-src-size').value;
            const srcPurity = document.getElementById('mix-src-purity').value;
            
            const destColor = document.getElementById('mix-dest-color').value;
            const destSize = document.getElementById('mix-dest-size').value;
            const destPurity = document.getElementById('mix-dest-purity').value;

            const weight = parseFloat(document.getElementById('mix-carat-weight').value) || 0;
            const rate = parseFloat(document.getElementById('mix-dest-rate').value) || 0;

            if (weight <= 0) { showCustomAlert("Validation Error", "Enter valid carat weights to execute shift.", "warning"); return; }
            if (rate <= 0) { showCustomAlert("Validation Error", "Enter valid assigned entry cost rate.", "warning"); return; }

            const srcKey = getStockKey(srcColor, srcSize, srcPurity);
            const destKey = getStockKey(destColor, destSize, destPurity);

            const available = ERP_STATE.stock[srcKey] || 0;
            
            // Custom validation warning checks with override support
            let hasWarning = false;
            let warningMsg = "";

            const avgRate = getAveragePurchaseRate(destSize, destPurity);
            const threshold = ERP_STATE.rateDeviationVal !== undefined ? ERP_STATE.rateDeviationVal : 10;
            if (avgRate > 0 && threshold > 0) {
                const diff = Math.abs(rate - avgRate);
                let hasViolation = false;
                let displayThresh = "";
                if (ERP_STATE.rateDeviationMode === 'amount') {
                    hasViolation = diff > threshold;
                    displayThresh = `₹${threshold}`;
                } else {
                    hasViolation = (diff / avgRate) > (threshold / 100);
                    displayThresh = `${threshold}%`;
                }

                if (hasViolation) {
                    hasWarning = true;
                    warningMsg += `Rate deviation is > ${displayThresh} from historical average (₹${Math.round(avgRate)}). `;
                }
            }

            if (available < weight) {
                hasWarning = true;
                warningMsg += `Insufficient source stock. Available: ${available.toFixed(3)} Cts. `;
            }

            if (hasWarning) {
                if (!ERP_STATE.forceOverride) {
                    const warnBanner = document.getElementById('mix-validation-warning');
                    if (warnBanner) {
                        warnBanner.style.display = 'flex';
                        warnBanner.querySelector('span').innerHTML = `⚠️ Allocation Discrepancy Detected: ${warningMsg} <a href="#" onclick="toggleForceOverride('mix'); return false;" style="color:#002878; text-decoration:underline; font-weight:bold; margin-left:10px;">[Force Approve Override]</a>`;
                    }
                    return;
                }
            }

            const mixWarnBanner = document.getElementById('mix-validation-warning');
            if (mixWarnBanner) mixWarnBanner.style.display = 'none';
            ERP_STATE.forceOverride = false;

            // Realtime adjustments
            ERP_STATE.stock[srcKey] -= weight;
            ERP_STATE.stock[destKey] = (ERP_STATE.stock[destKey] || 0) + weight;

            const mixInvNoPur = `MIX-PR-${Date.now()}`;
            const mixInvNoSale = `MIX-SL-${Date.now()}`;
            const today = new Date().toISOString().split('T')[0];

            // 3. Write Rojmel Entry
            const rojmelDoc = {
                time: today + " Transfer",
                type: "MIX-TRANSFER",
                msg: `Transferred ${weight.toFixed(3)} Cts from [${srcColor}-${srcSize}-${srcPurity}] to [${destColor}-${destSize}-${destPurity}] @ ₹${rate}/Ct`,
                delta: "Balanced Split",
                timestamp: Date.now()
            };
            ERP_STATE.rojmel.unshift(rojmelDoc);

            document.getElementById('mix-carat-weight').value = "";
            document.getElementById('mix-dest-rate').value = "";

            saveDatabaseState();
            renderAllDataComponents();
            showCustomAlert("Success", "Mix transfer executed and cost books recalculated.", "success");
        }

        // Initialize new active items, metadata, and filters state
        ERP_STATE.activePurchaseItems = [];
        ERP_STATE.activeSalesItems = [];
        ERP_STATE.invoiceMetadata = {};
        ERP_STATE.ledgerFilterParty = { pur: "", sale: "" };
        ERP_STATE.ledgerFilterPartyChked = { pur: true, sale: true };

        function calcLiveSheetRow(type) {
            const carats = parseFloat(document.getElementById(`${type}-sheet-carats`).value) || 0;
            const rate = parseFloat(document.getElementById(`${type}-sheet-rate`).value) || 0;
            const disc = parseFloat(document.getElementById(`${type}-sheet-disc`).value) || 0;
            const amount = carats * rate * (1 + disc / 100);
            document.getElementById(`${type}-sheet-amount`).value = amount > 0 ? amount.toFixed(2) : "";
        }

        function addSheetRow(type, nextFocusId) {
            const color = document.getElementById(`${type}-sheet-shade`).value.trim().toUpperCase();
            const size = document.getElementById(`${type}-sheet-size`).value.trim().toUpperCase();
            const clarity = document.getElementById(`${type}-sheet-number`).value.trim().toUpperCase();
            const carats = parseFloat(document.getElementById(`${type}-sheet-carats`).value) || 0;
            const rate = parseFloat(document.getElementById(`${type}-sheet-rate`).value) || 0;
            const disc = parseFloat(document.getElementById(`${type}-sheet-disc`).value) || 0;
            const remark = document.getElementById(`${type}-sheet-remark`).value.trim();

            if (!color) {
                showCustomAlert("Validation Error", "Please select a Shade.", "warning", () => {
                    document.getElementById(`${type}-sheet-shade`).focus();
                });
                return;
            }
            if (!size) {
                showCustomAlert("Validation Error", "Please select a Size.", "warning", () => {
                    document.getElementById(`${type}-sheet-size`).focus();
                });
                return;
            }
            if (!clarity) {
                showCustomAlert("Validation Error", "Please select a Purity.", "warning", () => {
                    document.getElementById(`${type}-sheet-number`).focus();
                });
                return;
            }
            if (carats <= 0 || rate <= 0) {
                showCustomAlert("Validation Error", "Please enter valid weight (Carats) and Rate.", "warning", () => {
                    document.getElementById(`${type}-sheet-carats`).focus();
                });
                return;
            }

            const activeItemsKey = type === 'pur' ? 'activePurchaseItems' : 'activeSalesItems';
            const items = ERP_STATE[activeItemsKey];

            // Auto-generate Stock ID (kept for DB compatibility)
            const stockIdVal = `STK-GEN-${Date.now().toString().slice(-6)}-${items.length + 1}`;

            // Custom Rate Deviation and Stock Shortage checks with bypass support
            let hasWarning = false;
            let warningMsg = "";

            const avgRate = getAveragePurchaseRate(size, clarity);
            const threshold = ERP_STATE.rateDeviationVal !== undefined ? ERP_STATE.rateDeviationVal : 10;
            if (avgRate > 0 && threshold > 0) {
                const diff = Math.abs(rate - avgRate);
                let hasViolation = false;
                let displayThresh = "";
                if (ERP_STATE.rateDeviationMode === 'amount') {
                    hasViolation = diff > threshold;
                    displayThresh = `₹${threshold}`;
                } else {
                    hasViolation = (diff / avgRate) > (threshold / 100);
                    displayThresh = `${threshold}%`;
                }

                if (hasViolation) {
                    hasWarning = true;
                    warningMsg += `Rate deviation is > ${displayThresh} from historical average (₹${Math.round(avgRate)}). `;
                }
            }

            if (type === 'sale') {
                const stockKey = getStockKey(color, size, clarity);
                const available = ERP_STATE.stock[stockKey] || 0;
                const invNo = document.getElementById(`${type}-form-inv-no`).value.trim();
                let originalInvoiceCarats = 0;
                if (invNo) {
                    const originalItems = ERP_STATE.salesLog.filter(x => x.invoice === invNo);
                    originalItems.forEach(oldItem => {
                        if (oldItem.color === color && oldItem.size === size && oldItem.clarity === clarity) {
                            originalInvoiceCarats += oldItem.carats;
                        }
                    });
                }
                const adjustedAvailable = available + originalInvoiceCarats;
                let draftSum = 0;
                items.forEach(itm => {
                    if (itm.color === color && itm.size === size && itm.clarity === clarity) {
                        draftSum += itm.carats;
                    }
                });

                if (adjustedAvailable < draftSum + carats) {
                    hasWarning = true;
                    warningMsg += `Insufficient stock balance. Available: ${adjustedAvailable.toFixed(3)} Cts. `;
                }
            }

            if (hasWarning) {
                if (!ERP_STATE.forceOverride) {
                    const warnBanner = document.getElementById(`${type}-validation-warning`);
                    if (warnBanner) {
                        warnBanner.style.display = 'flex';
                        warnBanner.querySelector('span').innerHTML = `⚠️ Allocation Discrepancy Detected: ${warningMsg} <a href="#" onclick="toggleForceOverride('${type}'); return false;" style="color:#002878; text-decoration:underline; font-weight:bold; margin-left:10px;">[Force Approve Override]</a>`;
                    }
                    return;
                }
            }

            const warnBanner = document.getElementById(`${type}-validation-warning`);
            if (warnBanner) warnBanner.style.display = 'none';
            ERP_STATE.forceOverride = false;

            const amount = carats * rate * (1 + disc / 100);

            // Push item (ascending order)
            items.push({
                sNo: items.length + 1,
                stockId: stockIdVal,
                shape: "ROUND",
                color,
                size,
                clarity,
                pcs: 0,
                carats,
                rate,
                disc,
                amount,
                netAmount: amount,
                remark: remark
            });

            // Clear spreadsheet entry inputs and reset dropdowns
            document.getElementById(`${type}-sheet-shade`).value = "";
            document.getElementById(`${type}-sheet-size`).value = "";
            document.getElementById(`${type}-sheet-number`).value = "";
            if (type === 'sale') document.getElementById('sale-sheet-avail').value = "";
            document.getElementById(`${type}-sheet-carats`).value = "";
            document.getElementById(`${type}-sheet-rate`).value = "";
            document.getElementById(`${type}-sheet-disc`).value = "";
            document.getElementById(`${type}-sheet-amount`).value = "";
            document.getElementById(`${type}-sheet-remark`).value = "";

            renderSheetTable(type);
            updateInvoiceTotals(type);

            // Focus next field (default: shade dropdown)
            const nextEl = document.getElementById(nextFocusId || `${type}-sheet-shade`);
            if (nextEl) nextEl.focus();
        }

        function renderSheetTable(type, isReadOnly) {
            const body = document.getElementById(`${type}-sheet-body`);
            const activeItemsKey = type === 'pur' ? 'activePurchaseItems' : 'activeSalesItems';
            const items = ERP_STATE[activeItemsKey];

            const colCount = type === 'pur' ? 10 : 11;
            if (items.length === 0) {
                body.innerHTML = `<tr><td colspan="${colCount}" style="text-align: center; color: var(--text-muted); padding: 15px; font-style: italic;">No items entered in grid sheet.</td></tr>`;
                return;
            }

            body.innerHTML = items.map((item, idx) => `
                <tr class="${isReadOnly ? 'erp-row-readonly' : ''}" ondblclick="${isReadOnly ? '' : `editSheetRow('${type}', ${idx})`}">
                    <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
                    <td>${item.color}</td>
                    <td>${item.size}</td>
                    <td><span style="background:rgba(0,0,0,0.04); padding:2px 6px; border-radius:4px; font-weight:600;">${item.clarity}</span></td>
                    ${type === 'sale' ? '<td style="text-align:right; color:var(--text-muted); font-size:0.75rem;"></td>' : ''}
                    <td style="text-align: right;">${item.carats.toFixed(2)}</td>
                    <td style="text-align: right;">₹${item.rate.toLocaleString('en-IN')}</td>
                    <td style="text-align: right; color: ${item.disc < 0 ? 'red' : item.disc > 0 ? 'green' : 'inherit'}">${item.disc !== undefined && item.disc !== 0 ? item.disc.toFixed(2) + '%' : '-'}</td>
                    <td style="text-align: right; font-weight: bold;">₹${item.amount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                    <td><span style="font-size:0.75rem; color:var(--text-muted);">${item.remark || ''}</span></td>
                    <td style="text-align: center;">
                        ${isReadOnly ? '' : `<span style="color: var(--danger-color); font-weight: bold; cursor: pointer; font-size: 1.1rem;" onclick="event.stopPropagation(); removeSheetRow('${type}', ${idx})">✖</span>`}
                    </td>
                </tr>
            `).join('');

            const snoNext = document.getElementById(`${type}-sheet-sno-next`);
            if (snoNext) snoNext.innerText = items.length + 1;
        }

        function removeSheetRow(type, idx) {
            const activeItemsKey = type === 'pur' ? 'activePurchaseItems' : 'activeSalesItems';
            ERP_STATE[activeItemsKey].splice(idx, 1);
            renderSheetTable(type);
            updateInvoiceTotals(type);
        }

        function editSheetRow(type, idx) {
            const activeItemsKey = type === 'pur' ? 'activePurchaseItems' : 'activeSalesItems';
            const item = ERP_STATE[activeItemsKey][idx];

            showCustomConfirm('Edit S.No', `Are you sure you want to edit S.No ${idx + 1}?`, () => {
                const newCarats = prompt("Enter new Carats:", item.carats);
                if (newCarats === null) return;
                const newRate = prompt("Enter new Rate:", item.rate);
                if (newRate === null) return;
                const newDisc = prompt("Enter new Disc % (e.g. -6.00):", item.disc || 0);
                if (newDisc === null) return;
                const newRemark = prompt("Enter new Remark:", item.remark || "");
                if (newRemark === null) return;

                const caratsVal = parseFloat(newCarats) || 0;
                const rateVal = parseFloat(newRate) || 0;
                const discVal = parseFloat(newDisc) || 0;

                if (caratsVal <= 0 || rateVal <= 0) {
                    showCustomAlert("Validation Error", "Invalid Carats or Rate entered.", "error");
                    return;
                }

                // Check stock sufficiency for sales
                if (type === 'sale') {
                    const stockKey = getStockKey(item.color, item.size, item.clarity);
                    const available = ERP_STATE.stock[stockKey] || 0;
                    
                    // If editing a saved invoice, we add back its original carats for this lot when verifying sufficiency
                    const invNo = document.getElementById(`${type}-form-inv-no`).value.trim();
                    let originalInvoiceCarats = 0;
                    if (invNo) {
                        const originalItems = ERP_STATE.salesLog.filter(x => x.invoice === invNo);
                        originalItems.forEach(oldItem => {
                            if (oldItem.color === item.color && oldItem.size === item.size && oldItem.clarity === item.clarity) {
                                originalInvoiceCarats += oldItem.carats;
                            }
                        });
                    }
                    const adjustedAvailable = available + originalInvoiceCarats;

                    let draftSum = 0;
                    ERP_STATE[activeItemsKey].forEach((itm, idx2) => {
                        if (idx2 !== idx && itm.color === item.color && itm.size === item.size && itm.clarity === item.clarity) {
                            draftSum += itm.carats;
                        }
                    });

                    if (adjustedAvailable < draftSum + caratsVal) {
                        showCustomAlert("Insufficient Stock", `Insufficient stock balance for lot [${item.color} | ${item.size} | ${item.clarity}]. Available: ${adjustedAvailable.toFixed(3)} Cts. Required: ${(draftSum + caratsVal).toFixed(3)} Cts.`, "error");
                        return;
                    }
                }

                item.carats = caratsVal;
                item.rate = rateVal;
                item.disc = discVal;
                item.remark = newRemark.trim();
                item.amount = caratsVal * rateVal * (1 + discVal / 100);
                item.netAmount = item.amount;

                renderSheetTable(type);
                updateInvoiceTotals(type);
            });
        }

        function addCustomExpensePrompt(type) {
            const desc = prompt("Enter expense/charge description (e.g. Shipping, Lab cost, Packaging):");
            if (!desc) return;
            const amountStr = prompt("Enter cost amount (use negative values for deductions/discounts):");
            if (!amountStr) return;

            const amtVal = parseFloat(amountStr) || 0;
            if (amtVal === 0) return;

            const invNo = document.getElementById(`${type}-form-inv-no`).value;
            if (!ERP_STATE.invoiceMetadata[invNo]) {
                ERP_STATE.invoiceMetadata[invNo] = { customExpenses: [] };
            }
            if (!ERP_STATE.invoiceMetadata[invNo].customExpenses) {
                ERP_STATE.invoiceMetadata[invNo].customExpenses = [];
            }
            ERP_STATE.invoiceMetadata[invNo].customExpenses.push({ desc: desc.trim(), amount: amtVal });

            renderCustomExpenses(type, invNo);
            updateInvoiceTotals(type);
        }

        function renderCustomExpenses(type, invNo) {
            const listEl = document.getElementById(`${type}-custom-expenses-list`);
            const bodyEl = document.getElementById(`${type}-custom-expenses-body`);
            if (!listEl || !bodyEl) return;

            const meta = ERP_STATE.invoiceMetadata[invNo];
            if (!meta || !meta.customExpenses || meta.customExpenses.length === 0) {
                listEl.style.display = 'none';
                bodyEl.innerHTML = "";
                return;
            }

            listEl.style.display = 'block';
            bodyEl.innerHTML = meta.customExpenses.map((exp, idx) => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px dashed #d0d0c8;">
                    <span>• ${exp.desc}: <strong>₹${exp.amount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong></span>
                    <span style="color:red; font-weight:bold; cursor:pointer;" onclick="removeCustomExpense('${type}', '${invNo}', ${idx})">✖</span>
                </div>
            `).join('');
        }

        function removeCustomExpense(type, invNo, idx) {
            if (ERP_STATE.invoiceMetadata[invNo] && ERP_STATE.invoiceMetadata[invNo].customExpenses) {
                ERP_STATE.invoiceMetadata[invNo].customExpenses.splice(idx, 1);
                renderCustomExpenses(type, invNo);
                updateInvoiceTotals(type);
            }
        }

        function updateInvoiceTotals(type) {
            const activeItemsKey = type === 'pur' ? 'activePurchaseItems' : 'activeSalesItems';
            const items = ERP_STATE[activeItemsKey];

            let totalCts = 0;
            let totalAmt = 0;

            items.forEach(itm => {
                totalCts += itm.carats;
                totalAmt += itm.amount;
            });

            // Add custom expenses from metadata if available
            const invNo = document.getElementById(`${type}-form-inv-no`).value;
            const meta = ERP_STATE.invoiceMetadata[invNo];
            if (meta && meta.customExpenses) {
                meta.customExpenses.forEach(exp => {
                    totalAmt += exp.amount;
                });
            }

            // Retrieve brokerage percentage
            const brokerPctVal = parseFloat(document.getElementById(`${type}-form-broker-pct`).value) || 0;

            let finalAmt = totalAmt;
            if (brokerPctVal !== 0) finalAmt = finalAmt * (1 + brokerPctVal / 100);

            const avgRate = totalCts > 0 ? finalAmt / totalCts : 0;

            document.getElementById(`${type}-summary-total-lbl`).innerText = `TOTAL... ${items.length}`;
            document.getElementById(`${type}-summary-cts`).innerText = `CTS : ${totalCts.toFixed(2)}`;
            document.getElementById(`${type}-summary-rate`).innerText = `AVG RATE : ${Math.round(avgRate)}`;
            document.getElementById(`${type}-form-total-amount`).value = finalAmt.toFixed(2);
        }



        function actionAddNew(type) {
            const activeItemsKey = type === 'pur' ? 'activePurchaseItems' : 'activeSalesItems';
            ERP_STATE[activeItemsKey] = [];

            // Reset Form parameter inputs
            const dateInput = document.getElementById(`${type}-form-date`);
            const todayStr = new Date().toISOString().split('T')[0];
            if (dateInput) dateInput.value = todayStr;

            document.getElementById(`${type}-form-inv-no`).value = "";
            document.getElementById(`${type}-form-party`).value = "";
            document.getElementById(`${type}-form-broker`).value = "";

            document.getElementById(`${type}-form-days`).value = "";
            document.getElementById(`${type}-form-broker-pct`).value = "";

            // Enable parameter headers
            document.getElementById(`${type}-form-date`).readOnly = false;
            document.getElementById(`${type}-form-inv-no`).readOnly = false;
            document.getElementById(`${type}-form-party`).disabled = false;
            document.getElementById(`${type}-form-broker`).disabled = false;

            document.getElementById(`${type}-form-days`).readOnly = false;
            document.getElementById(`${type}-form-broker-pct`).readOnly = false;

            // Generate AUTO NO and Invoice number
            const log = type === 'pur' ? ERP_STATE.purchaseLog : ERP_STATE.salesLog;
            
            // Auto number is unique invoices count + 1
            const uniqueInvoices = new Set(log.map(x => x.invoice));
            document.getElementById(`${type}-form-auto-no`).value = uniqueInvoices.size + 1;

            const nextCounter = ERP_STATE.invoiceCounters[type === 'pur' ? 'purchase' : 'sale'];
            const invNoVal = type === 'pur' ? `P${nextCounter}` : `S${nextCounter}`;
            document.getElementById(`${type}-form-inv-no`).value = invNoVal;

            // Initialize metadata with empty custom expenses
            if (!ERP_STATE.invoiceMetadata[invNoVal]) {
                ERP_STATE.invoiceMetadata[invNoVal] = { customExpenses: [] };
            } else {
                ERP_STATE.invoiceMetadata[invNoVal].customExpenses = [];
            }

            // Hide custom expenses list UI
            const listEl = document.getElementById(`${type}-custom-expenses-list`);
            const bodyEl = document.getElementById(`${type}-custom-expenses-body`);
            if (listEl) listEl.style.display = 'none';
            if (bodyEl) bodyEl.innerHTML = "";

            // Show sheet input row
            const inputRow = document.getElementById(`${type}-input-row`);
            if (inputRow) inputRow.style.display = 'table-row';

            // Clear sheet input cells and reset selectors to placeholders
            const elShade = document.getElementById(`${type}-sheet-shade`);
            if (elShade) elShade.value = "";
            const elSize = document.getElementById(`${type}-sheet-size`);
            if (elSize) elSize.value = "";
            const elNum = document.getElementById(`${type}-sheet-number`);
            if (elNum) elNum.value = "";
            const elCt = document.getElementById(`${type}-sheet-carats`);
            if (elCt) elCt.value = "";
            const elRate = document.getElementById(`${type}-sheet-rate`);
            if (elRate) elRate.value = "";
            const elDisc = document.getElementById(`${type}-sheet-disc`);
            if (elDisc) elDisc.value = "";
            const elAmt = document.getElementById(`${type}-sheet-amount`);
            if (elAmt) elAmt.value = "";
            const elRem = document.getElementById(`${type}-sheet-remark`);
            if (elRem) elRem.value = "";

            // Enable save button, hide delete & edit & slip
            document.getElementById(`${type}-btn-save`).style.display = 'inline-flex';
            document.getElementById(`${type}-btn-delete`).style.display = 'none';
            document.getElementById(`${type}-btn-edit`).style.display = 'none';
            const slipBtn = document.getElementById(`${type}-btn-slip`);
            if (slipBtn) slipBtn.style.display = 'none';

            renderSheetTable(type);
            updateInvoiceTotals(type);

            const dtField = document.getElementById(`${type}-form-date`);
            if (dtField) dtField.focus();
        }

        function actionSaveInvoice(type) {
            const activeItemsKey = type === 'pur' ? 'activePurchaseItems' : 'activeSalesItems';
            const items = ERP_STATE[activeItemsKey];

            if (items.length === 0) {
                showCustomAlert("Validation Error", "Please add at least one item row to the grid before saving.", "warning");
                return;
            }

            const date = document.getElementById(`${type}-form-date`).value;
            const invNo = document.getElementById(`${type}-form-inv-no`).value.trim();
            const party = document.getElementById(`${type}-form-party`).value;
            const broker = document.getElementById(`${type}-form-broker`).value;

            if (!date || !invNo || !party || !broker) {
                showCustomAlert("Validation Error", "Please fill all required fields (Date, Inv No, Party, Broker).", "warning");
                return;
            }

            const log = type === 'pur' ? ERP_STATE.purchaseLog : ERP_STATE.salesLog;
            const existingItems = log.filter(x => x.invoice === invNo);
            const isOverwrite = existingItems.length > 0;

            // Integrity Check: Prevent editing purchase invoice if it reduces stock below what was already sold
            if (type === 'pur' && isOverwrite) {
                const netChanges = {};
                for (const oldItem of existingItems) {
                    const key = getStockKey(oldItem.color, oldItem.size, oldItem.clarity);
                    netChanges[key] = (netChanges[key] || 0) - oldItem.carats;
                }
                for (const newItem of items) {
                    const key = getStockKey(newItem.color, newItem.size, newItem.clarity);
                    netChanges[key] = (netChanges[key] || 0) + newItem.carats;
                }

                for (const [key, netChange] of Object.entries(netChanges)) {
                    if (netChange < 0) {
                        const available = ERP_STATE.stock[key] || 0;
                        if (available + netChange < -0.0001) {
                            const parts = key.split('||');
                            showCustomAlert("Stock Integrity Block", `Cannot update this purchase invoice. The items (${parts[0]} - ${parts[1]} - ${parts[2]}) have already been sold. The edit would reduce the stock by ${Math.abs(netChange).toFixed(3)} Cts, but only ${available.toFixed(3)} Cts is available.`, "error");
                            return;
                        }
                    }
                }
            }

            const proceedSave = () => {
                // 1. Clone stock for transaction
                const tempStock = { ...ERP_STATE.stock };

                // 2. Simulate reverting old stock adjustments
                if (isOverwrite) {
                    for (const oldItem of existingItems) {
                        const stockKey = getStockKey(oldItem.color, oldItem.size, oldItem.clarity);
                        const available = tempStock[stockKey] || 0;
                        if (type === 'pur') {
                            tempStock[stockKey] = Math.max(0, available - oldItem.carats);
                        } else {
                            tempStock[stockKey] = available + oldItem.carats;
                        }
                    }
                }

                // 3. Simulate and validate new stock adjustments
                const days = parseInt(document.getElementById(`${type}-form-days`).value) || 0;
                const addLess1 = 0;
                const addLess2 = 0;
                const brokerage = parseFloat(document.getElementById(`${type}-form-broker-pct`).value) || 0;

                let totalCaratsSaved = 0;
                let finalItemsToSave = [];

                for (let idx = 0; idx < items.length; idx++) {
                    const item = items[idx];
                    const stockKey = getStockKey(item.color, item.size, item.clarity);
                    const available = tempStock[stockKey] || 0;

                    if (type === 'sale') {
                        if (available < item.carats) {
                            showCustomAlert("Save Blocked", `Insufficient stock balance for lot [${item.color} | ${item.size} | ${item.clarity}]. Available: ${available.toFixed(3)} Cts. Required: ${item.carats.toFixed(3)} Cts.`, "error");
                            return;
                        }
                        tempStock[stockKey] = available - item.carats;
                    } else {
                        tempStock[stockKey] = available + item.carats;
                    }

                    totalCaratsSaved += item.carats;

                    finalItemsToSave.push({
                        invoice: invNo,
                        sNo: item.sNo || (idx + 1),
                        date,
                        party,
                        broker,
                        color: item.color.trim().toUpperCase(),
                        size: item.size.trim().toUpperCase(),
                        clarity: item.clarity.trim().toUpperCase(),
                        carats: item.carats,
                        rate: item.rate,
                        amount: item.amount,
                        remark: item.remark || "",
                        stockId: item.stockId,
                        shape: "ROUND",
                        pcs: 0,
                        alPct1: 0, alAmt1: 0, alPct2: 0, alAmt2: 0
                    });
                }

                // 4. Commit transaction
                ERP_STATE.stock = tempStock;

                if (isOverwrite) {
                    // Remove old items from log
                    if (type === 'pur') {
                        ERP_STATE.purchaseLog = ERP_STATE.purchaseLog.filter(x => x.invoice !== invNo);
                    } else {
                        ERP_STATE.salesLog = ERP_STATE.salesLog.filter(x => x.invoice !== invNo);
                    }
                }

                // Retrieve custom expenses from draft
                const draftMeta = ERP_STATE.invoiceMetadata[invNo] || { customExpenses: [] };
                const customExpenses = draftMeta.customExpenses || [];

                const meta = {
                    party,
                    broker,
                    customExpenses: customExpenses,
                    noti: items[0].remark || "",
                    days: days,
                    addLess1: addLess1,
                    addLess2: addLess2,
                    brokerage: brokerage
                };

                // Save items into logs (unshift in reverse order to keep correct flat representation order)
                const targetLog = type === 'pur' ? ERP_STATE.purchaseLog : ERP_STATE.salesLog;
                for (let i = finalItemsToSave.length - 1; i >= 0; i--) {
                    targetLog.unshift(finalItemsToSave[i]);
                }

                // Save metadata
                ERP_STATE.invoiceMetadata[invNo] = meta;

                // Save database state
                saveDatabaseState();

                // Rojmel log
                const rojmelEntry = {
                    time: date + (isOverwrite ? " Edit" : " Log"),
                    type: type === 'pur' ? "PURCHASE" : "SALE",
                    msg: `${isOverwrite ? 'Updated' : 'Consolidated'} Invoice [${invNo}] - ${type === 'pur' ? 'Purchased' : 'Sold'} ${totalCaratsSaved.toFixed(3)} Cts total across ${items.length} lots from/to ${party}`,
                    delta: `${type === 'pur' ? '+' : '-'}${totalCaratsSaved.toFixed(3)} Cts`,
                    timestamp: Date.now()
                };
                ERP_STATE.rojmel.unshift(rojmelEntry);

                // Audit trail
                if (!ERP_STATE.auditTrail) ERP_STATE.auditTrail = [];
                const totalAmount = finalItemsToSave.reduce((sum, it) => sum + (it.amount || 0), 0);
                ERP_STATE.auditTrail.push({
                    id: 'AUD-' + Date.now(),
                    timestamp: new Date().toLocaleString(),
                    type: type === 'pur' ? 'PURCHASE' : 'SALE',
                    refNo: invNo,
                    party: party,
                    carats: totalCaratsSaved,
                    amount: totalAmount,
                    status: 'ACTIVE'
                });

                // Increment counter if it matched default prefix
                const currentCounter = ERP_STATE.invoiceCounters[type === 'pur' ? 'purchase' : 'sale'];
                if (invNo === (type === 'pur' ? `P${currentCounter}` : `S${currentCounter}`)) {
                    ERP_STATE.invoiceCounters[type === 'pur' ? 'purchase' : 'sale']++;
                }

                // Save database state again (to include Counter updates)
                saveDatabaseState();

                // Update UI and reset forms immediately
                renderAllDataComponents();
                actionAddNew(type);

                showCustomAlert("Success", `Fulfillment Approved: Invoice ${invNo} saved and balances updated.`, "success");
            };

            if (isOverwrite) {
                showCustomConfirm("Overwrite Invoice", `Invoice ${invNo} already exists. Overwrite invoice?`, proceedSave, null, "warning");
            } else {
                proceedSave();
            }
        }

        function actionDeleteInvoice(type) {
            const invNo = document.getElementById(`${type}-form-inv-no`).value.trim();
            if (!invNo) return;

            const logKey = type === 'pur' ? 'purchaseLog' : 'salesLog';
            const log = ERP_STATE[logKey];
            const matching = log.filter(x => x.invoice === invNo);

            // Stock Integrity Check: Prevent deleting purchase invoice if items were already sold
            if (type === 'pur') {
                const delAmounts = {};
                for (const item of matching) {
                    const stockKey = getStockKey(item.color, item.size, item.clarity);
                    delAmounts[stockKey] = (delAmounts[stockKey] || 0) + item.carats;
                }
                
                for (const [stockKey, caratsToDelete] of Object.entries(delAmounts)) {
                    const available = ERP_STATE.stock[stockKey] || 0;
                    if (available - caratsToDelete < -0.0001) {
                        const parts = stockKey.split('||');
                        showCustomAlert("Stock Integrity Block", `Cannot delete this purchase invoice. The items (${parts[0]} - ${parts[1]} - ${parts[2]}) have already been sold. Remaining stock (${available.toFixed(3)} Cts) is less than the amount being deleted (${caratsToDelete.toFixed(3)} Cts).`, "error");
                        return;
                    }
                }
            }

            challengeAdminPassword(() => {
                showCustomConfirm('Delete Invoice', `Are you absolutely sure you want to delete invoice ${invNo}? This will revert all stock adjustments.`, () => {
                    const logKey = type === 'pur' ? 'purchaseLog' : 'salesLog';
                    const log = ERP_STATE[logKey];

                    const matching = log.filter(x => x.invoice === invNo);
                    
                    // Revert stock adjustments
                    for (const item of matching) {
                        const stockKey = getStockKey(item.color, item.size, item.clarity);
                        const available = ERP_STATE.stock[stockKey] || 0;

                        if (type === 'pur') {
                            // Purchase subtraction
                            ERP_STATE.stock[stockKey] = Math.max(0, available - item.carats);
                        } else {
                            // Sale addition back
                            ERP_STATE.stock[stockKey] = available + item.carats;
                        }
                    }

                    // Remove items from log
                    ERP_STATE[logKey] = log.filter(x => x.invoice !== invNo);

                    // Remove metadata
                    delete ERP_STATE.invoiceMetadata[invNo];

                    // Rojmel log
                    const rojmelEntry = {
                        time: new Date().toISOString().split('T')[0] + " Del",
                        type: type === 'pur' ? "PURCHASE" : "SALE",
                        msg: `Deleted Consolidated Invoice [${invNo}]`,
                        delta: "Reverted Stocks",
                        timestamp: Date.now()
                    };
                    ERP_STATE.rojmel.unshift(rojmelEntry);

                    // Audit trail deletion marker
                    const auditItem = (ERP_STATE.auditTrail || []).find(x => x.type === (type === 'pur' ? 'PURCHASE' : 'SALE') && x.refNo === invNo);
                    if (auditItem) {
                        auditItem.status = 'DELETED';
                        auditItem.deletedAt = new Date().toLocaleString();
                    }

                    // Save database state
                    saveDatabaseState();

                    // Update UI and reset forms immediately
                    renderAllDataComponents();
                    actionAddNew(type);

                    showCustomAlert("Success", `Invoice ${invNo} successfully deleted.`, "success");
                }, null, 'danger');
            }, `Enter password to delete this ${type === 'pur' ? 'purchase' : 'sale'} invoice:`, null, 'edit');
        }

        function actionClose(type) {
            switchView('view-stock');
        }

        function actionPrint(type) {
            window.print();
        }

        function lockFormFields(type) {
            document.getElementById(`${type}-form-date`).readOnly = true;
            document.getElementById(`${type}-form-inv-no`).readOnly = true;
            document.getElementById(`${type}-form-party`).disabled = true;
            document.getElementById(`${type}-form-broker`).disabled = true;

            document.getElementById(`${type}-form-days`).readOnly = true;
            document.getElementById(`${type}-form-broker-pct`).readOnly = true;

            // Hide sheet input row
            const inputRow = document.getElementById(`${type}-input-row`);
            if (inputRow) inputRow.style.display = 'none';

            // Buttons visibility
            document.getElementById(`${type}-btn-save`).style.display = 'none';
            document.getElementById(`${type}-btn-delete`).style.display = 'inline-flex';
            document.getElementById(`${type}-btn-edit`).style.display = 'inline-flex';
            const slipBtn = document.getElementById(`${type}-btn-slip`);
            if (slipBtn) slipBtn.style.display = 'inline-flex';

            renderSheetTable(type, true); // True means read-only view
        }

        function unlockFormFields(type, onCancel = null) {
            challengeAdminPassword(() => {
                document.getElementById(`${type}-form-date`).readOnly = false;
                document.getElementById(`${type}-form-inv-no`).readOnly = false;
                document.getElementById(`${type}-form-party`).disabled = false;
                document.getElementById(`${type}-form-broker`).disabled = false;

                document.getElementById(`${type}-form-days`).readOnly = false;
                document.getElementById(`${type}-form-broker-pct`).readOnly = false;

                // Show sheet input row
                const inputRow = document.getElementById(`${type}-input-row`);
                if (inputRow) inputRow.style.display = 'table-row';

                // Buttons visibility
                document.getElementById(`${type}-btn-save`).style.display = 'inline-flex';
                document.getElementById(`${type}-btn-delete`).style.display = 'inline-flex';
                document.getElementById(`${type}-btn-edit`).style.display = 'none';
                const slipBtn = document.getElementById(`${type}-btn-slip`);
                if (slipBtn) slipBtn.style.display = 'inline-flex';

                renderSheetTable(type, false); // False means editable view
            }, `Enter password to edit this ${type === 'pur' ? 'purchase' : 'sale'} invoice:`, onCancel, 'edit');
        }

        function loadInvoiceIntoForm(type, invoiceNo) {
            showCustomConfirm('Load Invoice', `Would you like to edit invoice ${invoiceNo}?`, () => {
                executeLoadInvoice(type, invoiceNo, true);
            }, () => {
                executeLoadInvoice(type, invoiceNo, false);
            }, 'info');
        }

        function executeLoadInvoice(type, invoiceNo, wantToEdit) {
            const log = type === 'pur' ? ERP_STATE.purchaseLog : ERP_STATE.salesLog;
            const items = log.filter(x => x.invoice === invoiceNo);
            if (items.length === 0) {
                showCustomAlert("Error", `Invoice ${invoiceNo} not found in logs.`, "error");
                return;
            }

            const activeItemsKey = type === 'pur' ? 'activePurchaseItems' : 'activeSalesItems';
            
            // Sort by explicit sNo ascending to preserve entry sequence
            items.sort((a, b) => (a.sNo || 0) - (b.sNo || 0));

            // Map historical logs back into draft active items format
            ERP_STATE[activeItemsKey] = items.map(itm => ({
                sNo: itm.sNo,
                stockId: itm.stockId || `STK-${itm.invoice}`,
                shape: itm.shape || "ROUND",
                color: itm.color,
                size: itm.size,
                clarity: itm.clarity,
                pcs: itm.pcs || 0,
                carats: itm.carats,
                rate: itm.rate,
                disc: itm.disc || 0,
                alPct1: itm.alPct1 || 0,
                alAmt1: itm.alAmt1 || 0,
                alPct2: itm.alPct2 || 0,
                alAmt2: itm.alAmt2 || 0,
                amount: itm.amount,
                netAmount: itm.amount,
                remark: itm.remark || ""
            }));

            // Retrieve metadata
            const meta = ERP_STATE.invoiceMetadata[invoiceNo] || {
                party: items[0].party,
                broker: items[0].broker,
                noti: items[0].remark || "",
                customExpenses: []
            };

            // Set AUTO NO to the invoice index in the unique list
            const uniqueInvoices = Array.from(new Set(log.map(x => x.invoice))).reverse();
            const idx = uniqueInvoices.indexOf(invoiceNo);
            document.getElementById(`${type}-form-auto-no`).value = idx !== -1 ? (uniqueInvoices.length - idx) : "";

            // Populate parameter header fields
            document.getElementById(`${type}-form-date`).value = items[0].date;
            document.getElementById(`${type}-form-inv-no`).value = invoiceNo;
            document.getElementById(`${type}-form-party`).value = items[0].party;
            document.getElementById(`${type}-form-broker`).value = items[0].broker;

            document.getElementById(`${type}-form-days`).value = Math.round(meta.days || 0);
            document.getElementById(`${type}-form-broker-pct`).value = parseFloat(meta.brokerage || 0).toFixed(2);

            // Render custom expenses
            renderCustomExpenses(type, invoiceNo);

            if (wantToEdit) {
                unlockFormFields(type, () => {
                    lockFormFields(type);
                });
            } else {
                lockFormFields(type);
            }
            updateInvoiceTotals(type);
        }

        function renderLedger(type) {
            const body = document.getElementById(`${type}-ledger-body`);
            if (!body) return;

            const log = type === 'pur' ? ERP_STATE.purchaseLog : ERP_STATE.salesLog;
            const fromVal = document.getElementById(`${type}-search-from`).value;
            const toVal = document.getElementById(`${type}-search-to`).value;
            const chked = ERP_STATE.ledgerFilterPartyChked[type];
            const filterPartyText = ERP_STATE.ledgerFilterParty[type].toLowerCase();

            // Group transactions by invoice number
            const grouped = {};
            log.forEach(item => {
                if (!grouped[item.invoice]) {
                    grouped[item.invoice] = [];
                }
                grouped[item.invoice].push(item);
            });

            // Filter invoices
            const invoicesList = [];
            for (const [invoice, items] of Object.entries(grouped)) {
                const first = items[0];
                const date = new Date(first.date);
                
                // Date range filters
                if (fromVal && date < new Date(fromVal)) continue;
                if (toVal && date > new Date(toVal)) continue;

                // Party filter contains
                if (chked && filterPartyText) {
                    if (!first.party.toLowerCase().includes(filterPartyText)) continue;
                }

                // Retrieve invoice metadata
                const metadata = ERP_STATE.invoiceMetadata[invoice] || {
                    isGia: "No",
                    rsType: "Rs",
                    noti: first.remark || ""
                };

                invoicesList.push({
                    invoice: invoice,
                    date: first.date,
                    party: first.party,
                    note: metadata.noti || first.remark || "",
                    isGia: metadata.isGia || "No",
                    rsType: metadata.rsType || "Rs"
                });
            }

            // Sort invoices by date and invoice ID descending
            invoicesList.sort((a, b) => b.invoice.localeCompare(a.invoice));

            // Render matching rows
            body.innerHTML = invoicesList.map(inv => {
                const displayInvoice = inv.invoice
                    .replace('INV-PR-', 'P')
                    .replace('INV-SL-', 'S');
                const dateParts = inv.date.split('-');
                const displayDate = dateParts.length === 3
                    ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`
                    : inv.date;
                return `
                    <tr onclick="loadInvoiceIntoForm('${type}', '${inv.invoice}')" style="cursor: pointer;">
                        <td><strong>${displayInvoice}</strong></td>
                        <td>${displayDate}</td>
                        <td>${inv.party}</td>
                        <td><span style="font-size:0.75rem; color:var(--text-muted);">${inv.note}</span></td>
                    </tr>
                `;
            }).join('');

            // Update footer count
            const countEl = document.getElementById(`${type}-ledger-count`);
            if (countEl) countEl.innerText = invoicesList.length;
        }

        function toggleFilterPopover(type) {
            const popover = document.getElementById(`${type}-filter-popover`);
            if (popover) {
                popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
            }
        }

        function applyLedgerFilters(type) {
            renderLedger(type);
            toggleFilterPopover(type);
        }

        function clearAllLedgerFilters(type) {
            const fromInput = document.getElementById(`${type}-search-from`);
            const toInput = document.getElementById(`${type}-search-to`);
            if (fromInput) fromInput.value = "";
            if (toInput) toInput.value = "";
            renderLedger(type);
            toggleFilterPopover(type);
        }

        function saveAdminPassword() {
            // Legacy compatibility – now handled by updateAdminCredentials()
            updateAdminCredentials();
        }

        // ── Custom Dialog Modal Methods ─────────────────────────────
        let customDialogCallback = null;
        let customDialogCancelCallback = null;

        function showCustomAlert(title, message, type = 'info', onOk = null) {
            const overlay = document.getElementById('custom-dialog-overlay');
            const iconEl = document.getElementById('custom-dialog-icon');
            const titleEl = document.getElementById('custom-dialog-title');
            const msgEl = document.getElementById('custom-dialog-msg');
            const btnOk = document.getElementById('custom-dialog-btn-ok');
            const btnCancel = document.getElementById('custom-dialog-btn-cancel');

            let icon = 'ℹ️';
            let titleColor = '#3498db';
            if (type === 'success') {
                icon = '✅';
                titleColor = '#2ecc71';
            } else if (type === 'error') {
                icon = '❌';
                titleColor = '#e74c3c';
            } else if (type === 'warning') {
                icon = '⚠️';
                titleColor = '#f1c40f';
            }

            iconEl.innerText = icon;
            titleEl.innerText = title;
            titleEl.style.color = titleColor;
            msgEl.innerText = message;

            btnCancel.style.display = 'none';
            btnOk.innerText = 'OK';
            btnOk.style.background = '#002878';
            btnOk.style.borderColor = '#002878';
            btnOk.style.color = 'white';

            customDialogCallback = onOk;
            customDialogCancelCallback = null;

            overlay.style.display = 'flex';
            btnOk.focus();
        }

        function showCustomConfirm(title, message, onConfirm, onCancel = null, type = 'warning') {
            const overlay = document.getElementById('custom-dialog-overlay');
            const iconEl = document.getElementById('custom-dialog-icon');
            const titleEl = document.getElementById('custom-dialog-title');
            const msgEl = document.getElementById('custom-dialog-msg');
            const btnOk = document.getElementById('custom-dialog-btn-ok');
            const btnCancel = document.getElementById('custom-dialog-btn-cancel');

            let icon = '⚠️';
            let titleColor = '#f1c40f';
            if (type === 'danger') {
                icon = '⚠️';
                titleColor = '#e74c3c';
            } else if (type === 'info') {
                icon = '❓';
                titleColor = '#3498db';
            }

            iconEl.innerText = icon;
            titleEl.innerText = title;
            titleEl.style.color = titleColor;
            msgEl.innerText = message;

            btnCancel.style.display = 'inline-flex';
            btnOk.innerText = 'Yes, Proceed';
            if (type === 'danger') {
                btnOk.style.background = '#e74c3c';
                btnOk.style.borderColor = '#e74c3c';
            } else if (type === 'info') {
                btnOk.style.background = '#3498db';
                btnOk.style.borderColor = '#3498db';
            } else {
                btnOk.style.background = '#002878';
                btnOk.style.borderColor = '#002878';
            }
            btnOk.style.color = 'white';

            customDialogCallback = onConfirm;
            customDialogCancelCallback = onCancel;

            overlay.style.display = 'flex';
            btnOk.focus();
        }

        function closeCustomDialog(action) {
            const overlay = document.getElementById('custom-dialog-overlay');
            overlay.style.display = 'none';

            if (action === 'ok') {
                if (typeof customDialogCallback === 'function') {
                    customDialogCallback();
                }
            } else {
                if (typeof customDialogCancelCallback === 'function') {
                    customDialogCancelCallback();
                }
            }
            customDialogCallback = null;
            customDialogCancelCallback = null;
        }

        function actionClearForm(type) {
            showCustomConfirm('Clear Form', 'Are you sure you want to clear the entire form and reset all fields?', () => {
                actionAddNew(type);
            }, null, 'warning');
        }

        // ── Invoice Slip Visual Generator & Image Downloader ─────────
        function actionGenerateSlip(type) {
            const autoNo = document.getElementById(`${type}-form-auto-no`).value;
            const dateVal = document.getElementById(`${type}-form-date`).value;
            const partyVal = document.getElementById(`${type}-form-party`).value;
            const brokerVal = document.getElementById(`${type}-form-broker`).value;
            const daysVal = document.getElementById(`${type}-form-days`).value;
            const brokerPctVal = parseFloat(document.getElementById(`${type}-form-broker-pct`).value) || 0;

            const activeItemsKey = type === 'pur' ? 'activePurchaseItems' : 'activeSalesItems';
            const items = ERP_STATE[activeItemsKey];

            if (items.length === 0) {
                showCustomAlert("Error", "No items to show on slip.", "warning");
                return;
            }

            // Calculate total carats and average/weighted rate
            let totalCts = 0;
            let totalBaseAmt = 0;
            items.forEach(itm => {
                totalCts += itm.carats;
                totalBaseAmt += itm.carats * itm.rate;
            });
            const avgRate = totalCts > 0 ? totalBaseAmt / totalCts : 0;

            // Calculate total net amount including row-level discounts
            let totalAmtWithRowDiscs = 0;
            let totalItemBaseAmt = 0;
            let totalItemDiscWeighted = 0;
            items.forEach(itm => {
                totalAmtWithRowDiscs += itm.amount;
                const base = itm.carats * itm.rate;
                totalItemBaseAmt += base;
                totalItemDiscWeighted += base * (itm.disc || 0);
            });

            // Calculate overall weighted average discount percentage for the slip
            const avgDiscPct = totalItemBaseAmt > 0 ? (totalItemDiscWeighted / totalItemBaseAmt) : 0;

            // Apply brokerage on top of total items amount (which has row discounts)
            let finalAmt = totalAmtWithRowDiscs;
            if (brokerPctVal !== 0) finalAmt = finalAmt * (1 + brokerPctVal / 100);

            // Populate slip details in slip view
            document.getElementById('slip-serial').innerText = `${type === 'pur' ? 'P' : 'S'} ${autoNo}`;
            
            // Format date: YYYY-MM-DD -> DD-MM-YYYY
            let formattedDate = "";
            if (dateVal) {
                const parts = dateVal.split('-');
                if (parts.length === 3) {
                    formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                } else {
                    formattedDate = dateVal;
                }
            }
            document.getElementById('slip-date').innerText = formattedDate;
            document.getElementById('slip-days').innerText = `{ ${daysVal} }`;
            document.getElementById('slip-party').innerText = partyVal.toUpperCase();
            document.getElementById('slip-broker').innerText = `${brokerVal.toUpperCase()} (${brokerPctVal.toFixed(2)}%)`;
            
            // Render values exact
            document.getElementById('slip-carat').innerText = totalCts.toFixed(2);
            document.getElementById('slip-rate').innerText = avgRate.toFixed(2);
            document.getElementById('slip-total').innerText = finalAmt.toFixed(2);

            // Format brackets
            const formatPct = (val) => {
                if (val === 0) return "0.00";
                return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
            };
            document.getElementById('slip-bracket-vals').innerText = `{   ${formatPct(avgDiscPct)}   }`;

            // Save slip state for back button
            ERP_STATE.slipBackView = type === 'pur' ? 'view-purchase' : 'view-sale';

            switchView('view-slip');
            
            // Generate canvas for download compatibility
            renderSlipCanvas();
        }

        function renderSlipCanvas() {
            const canvas = document.getElementById('slip-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            
            // Set canvas size
            canvas.width = 500;
            canvas.height = 550;

            // Fill white background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw text
            ctx.fillStyle = '#000000';
            ctx.textBaseline = 'top';

            // Title: "good luck"
            ctx.font = 'bold 24px Courier New, monospace';
            ctx.textAlign = 'center';
            ctx.fillText('good luck', 250, 40);

            // Row 2: "P 385          08-06-2026   { 45 }"
            ctx.font = 'bold 18px Courier New, monospace';
            
            const serial = document.getElementById('slip-serial').innerText;
            ctx.textAlign = 'left';
            ctx.fillText(serial, 40, 90);

            const date = document.getElementById('slip-date').innerText;
            ctx.textAlign = 'center';
            ctx.fillText(date, 250, 90);

            const days = document.getElementById('slip-days').innerText;
            ctx.textAlign = 'right';
            ctx.fillText(days, 460, 90);

            // Row 3: Party Name (centered)
            const party = document.getElementById('slip-party').innerText;
            ctx.font = 'bold 22px Courier New, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(party, 250, 140);

            // Row 4: Broker Name (centered)
            const broker = document.getElementById('slip-broker').innerText;
            ctx.font = 'normal 18px Courier New, monospace';
            ctx.fillText(broker, 250, 180);

            // Row 5: Carat (left-aligned)
            const carat = document.getElementById('slip-carat').innerText;
            ctx.font = 'bold 20px Courier New, monospace';
            ctx.textAlign = 'left';
            ctx.fillText(carat, 40, 240);

            // Row 6: Rate (left-aligned)
            const rate = document.getElementById('slip-rate').innerText;
            ctx.font = 'normal 20px Courier New, monospace';
            ctx.fillText(rate, 40, 290);

            // Row 7: Brackets with percentages (centered)
            const bracketVals = document.getElementById('slip-bracket-vals').innerText;
            ctx.font = 'normal 18px Courier New, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(bracketVals, 250, 340);

            // Row 8: Net Amount (left-aligned)
            const total = document.getElementById('slip-total').innerText;
            ctx.font = 'bold 22px Courier New, monospace';
            ctx.textAlign = 'left';
            ctx.fillText(total, 40, 395);

            // Row 9: "|| HARDWORK IS A KEY TO SUCCESS ||" (centered)
            ctx.font = 'bold 16px Courier New, monospace';
            ctx.textAlign = 'center';
            ctx.fillText('|| HARDWORK IS A KEY TO SUCCESS ||', 250, 480);
        }

        function downloadSlipImage() {
            const canvas = document.getElementById('slip-canvas');
            if (!canvas) return;
            const serial = document.getElementById('slip-serial').innerText.replace(/\s+/g, '_');
            const date = document.getElementById('slip-date').innerText;
            const link = document.createElement('a');
            link.download = `Slip_${serial}_${date}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }

        function goBackFromSlip() {
            if (ERP_STATE.slipBackView) {
                switchView(ERP_STATE.slipBackView);
            } else {
                switchView('view-purchase');
            }
        }

        let activePasswordCallback = null;
        let activePasswordCancelCallback = null;
        let activePasswordChallengeType = 'admin';

        function challengeAdminPassword(callback, message = "", cancelCallback = null, challengeType = 'admin') {
            activePasswordCallback = callback;
            activePasswordCancelCallback = cancelCallback;
            activePasswordChallengeType = challengeType;
            document.getElementById('password-challenge-msg').innerText = message || "Please enter the password to proceed.";
            document.getElementById('challenge-password-input').value = "";
            document.getElementById('challenge-password-error').innerText = "";
            document.getElementById('password-modal-overlay').style.display = 'block';
            document.getElementById('password-challenge-modal').style.display = 'block';
            
            const pInput = document.getElementById('challenge-password-input');
            pInput.type = 'password';
            const eyeBtn = pInput.nextElementSibling;
            if (eyeBtn) eyeBtn.innerText = '👁️';

            pInput.focus();

            pInput.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    submitPasswordChallenge();
                }
            };
        }

        function submitPasswordChallenge() {
            const inputVal = document.getElementById('challenge-password-input').value;
            const correctPass = ERP_STATE.editPassword || "edit123";
            const errEl = document.getElementById('challenge-password-error');

            if (inputVal === correctPass) {
                document.getElementById('password-modal-overlay').style.display = 'none';
                document.getElementById('password-challenge-modal').style.display = 'none';
                if (typeof activePasswordCallback === 'function') {
                    activePasswordCallback();
                }
                activePasswordCallback = null;
                activePasswordCancelCallback = null;
            } else {
                errEl.innerText = "❌ Incorrect password. Please try again.";
                document.getElementById('challenge-password-input').value = "";
                document.getElementById('challenge-password-input').focus();
            }
        }

        function cancelPasswordChallenge() {
            document.getElementById('password-modal-overlay').style.display = 'none';
            document.getElementById('password-challenge-modal').style.display = 'none';
            const cancelCb = activePasswordCancelCallback;
            activePasswordCallback = null;
            activePasswordCancelCallback = null;
            if (typeof cancelCb === 'function') {
                cancelCb();
            }
        }

        function handleBhavDblClick(event) {
            const inputEl = event.target;
            if (!inputEl.readOnly) return; // already editable
            
            const makeEditable = () => {
                inputEl.readOnly = false;
                inputEl.style.background = 'white';
                inputEl.style.color = 'var(--text-main)';
                inputEl.style.cursor = 'text';
                inputEl.style.border = '2px solid #002878';
                inputEl.focus();
                inputEl.select();
                
                // Re-lock on blur
                inputEl.addEventListener('blur', function onBlur() {
                    inputEl.readOnly = true;
                    inputEl.style.background = '#f0f4ff';
                    inputEl.style.color = '#002878';
                    inputEl.style.cursor = 'default';
                    inputEl.style.border = '1px solid #b0b0a8';
                    recalcSeriesWizardCalculations();
                    inputEl.removeEventListener('blur', onBlur);
                }, { once: true });
            };

            if (ERP_STATE.priceEditingUnlocked) {
                makeEditable();
            } else {
                challengeAdminPassword(() => {
                    ERP_STATE.priceEditingUnlocked = true;
                    makeEditable();
                }, "Enter admin password to change the rate (Bhav) for this lot:");
            }
        }

        function handleBhavInputClick(event) {
            // No action
        }

        function unlockPriceEditing() {
            // Deprecated - lock is managed dynamically per field double-click
        }

        function switchOpeningSubTab(tab) {
            const btnWizard = document.getElementById('btn-opening-wizard');
            const btnMaster = document.getElementById('btn-opening-master');
            const contentWizard = document.getElementById('opening-wizard-content');
            const contentMaster = document.getElementById('opening-master-content');
            
            if (tab === 'wizard') {
                if (btnWizard) btnWizard.classList.add('active');
                if (btnMaster) btnMaster.classList.remove('active');
                if (contentWizard) contentWizard.style.display = 'flex';
                if (contentMaster) contentMaster.style.display = 'none';
                renderOpeningWizardTable();
            } else if (tab === 'master') {
                if (btnWizard) btnWizard.classList.remove('active');
                if (btnMaster) btnMaster.classList.add('active');
                if (contentWizard) contentWizard.style.display = 'none';
                if (contentMaster) contentMaster.style.display = 'block';
                renderSeriesPurityMaster();
            }
        }

        function renderSeriesPurityMaster() {
            const seriesPurities = ERP_STATE.masters.seriesPurities || [];
            const listUl = document.getElementById('series-purity-list-ul');
            if (listUl) {
                listUl.innerHTML = seriesPurities.map((purity, idx) => `
                    <li style="display: flex; justify-content: space-between; align-items: center; background: white; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.8rem; font-weight: bold; margin-bottom: 4px;">
                        <span style="color: #334155;">${idx + 1}. ${purity}</span>
                        <div style="display: flex; gap: 4px;">
                            <button class="erp-btn" onclick="moveSeriesPurity(${idx}, -1)" style="padding: 1px 6px; font-size: 0.7rem; border-color: #cbd5e1;" title="Move Up">▲</button>
                            <button class="erp-btn" onclick="moveSeriesPurity(${idx}, 1)" style="padding: 1px 6px; font-size: 0.7rem; border-color: #cbd5e1;" title="Move Down">▼</button>
                            <button class="erp-btn" onclick="deleteSeriesPurity(${idx})" style="padding: 1px 6px; font-size: 0.7rem; color: #e74c3c; border-color: #fecaca;" title="Remove">✕</button>
                        </div>
                    </li>
                `).join('');
            }

            const refUl = document.getElementById('global-purity-reference-ul');
            if (refUl) {
                refUl.innerHTML = ERP_STATE.masters.numbers.map(purity => {
                    const isAdded = seriesPurities.includes(purity);
                    const btnStyle = isAdded ? 'background: #cbd5e1; color: #64748b; cursor: default; border-color: #cbd5e1;' : 'background: #eff6ff; color: #1e40af; border-color: #bfdbfe; cursor: pointer;';
                    const actionHtml = isAdded ? 'Added' : `<span style="font-weight: bold; font-size: 0.85rem; margin-right: 4px;">+</span> Add`;
                    const onclickAttr = isAdded ? '' : `onclick="addSeriesPurityFromGlobal('${purity.replace(/'/g, "\\'")}')"`;
                    return `
                        <li ${onclickAttr} style="display: flex; align-items: center; padding: 4px 10px; border: 1px solid; border-radius: 4px; font-size: 0.75rem; font-weight: bold; ${btnStyle}">
                            <span style="margin-right: 6px;">${purity}</span>
                            ${actionHtml}
                        </li>
                    `;
                }).join('');
            }
        }

        function addSeriesPurity() {
            const input = document.getElementById('new-series-purity-name');
            const val = input.value.trim();
            if (!val) return;
            
            if (!ERP_STATE.masters.seriesPurities) {
                ERP_STATE.masters.seriesPurities = [];
            }
            if (ERP_STATE.masters.seriesPurities.includes(val)) {
                showCustomAlert("Validation Error", "This purity is already added to the series list.", "warning");
                return;
            }
            
            ERP_STATE.masters.seriesPurities.push(val);
            saveDatabaseState();
            input.value = "";
            renderSeriesPurityMaster();
        }

        function addSeriesPurityFromGlobal(purity) {
            if (!ERP_STATE.masters.seriesPurities) {
                ERP_STATE.masters.seriesPurities = [];
            }
            if (ERP_STATE.masters.seriesPurities.includes(purity)) return;
            
            ERP_STATE.masters.seriesPurities.push(purity);
            saveDatabaseState();
            renderSeriesPurityMaster();
        }

        function deleteSeriesPurity(idx) {
            showCustomConfirm('Remove Purity', "Are you sure you want to remove this purity from the series wizard? (This does not delete any stock data)", () => {
                ERP_STATE.masters.seriesPurities.splice(idx, 1);
                saveDatabaseState();
                renderSeriesPurityMaster();
            });
        }

        function moveSeriesPurity(idx, dir) {
            const list = ERP_STATE.masters.seriesPurities;
            const target = idx + dir;
            if (target < 0 || target >= list.length) return;
            
            const temp = list[idx];
            list[idx] = list[target];
            list[target] = temp;
            
            saveDatabaseState();
            renderSeriesPurityMaster();
        }

        function updateOpeningSourceStock() {
            const selectedPurity = document.getElementById('opening-source-purity').value;
            const color = document.getElementById('opening-color').value.trim().toUpperCase() || 'White';
            const mixEl = document.getElementById('opening-src-avail-mix');
            if (!selectedPurity) {
                if (mixEl) mixEl.innerText = "0.000";
                return;
            }
            const keyMix = `${color}||MIX||${selectedPurity}`;
            const availMix = ERP_STATE.stock[keyMix] || 0;
            
            if (mixEl) mixEl.innerText = availMix.toFixed(3);

            // Re-trigger warnings calculation
            recalcSeriesWizardCalculations();
        }

        function getWeightedAveragePurchaseRate(purity, size, color) {
            let totalCts = 0;
            let totalAmt = 0;
            const normPurity = (purity || "").trim().toUpperCase();
            const normSize = (size || "").trim().toUpperCase();
            const normColor = (color || "").trim().toUpperCase();
            ERP_STATE.purchaseLog.forEach(p => {
                if ((p.clarity || "").trim().toUpperCase() === normPurity && 
                    (p.size || "").trim().toUpperCase() === normSize && 
                    (p.color || "").trim().toUpperCase() === normColor) {
                    totalCts += p.carats;
                    totalAmt += p.amount;
                }
            });
            return totalCts > 0 ? (totalAmt / totalCts) : 0;
        }

        function renderOpeningWizardTable() {
            const tbody = document.getElementById('opening-series-body');
            if (!tbody) return;

            const purities = ERP_STATE.masters.seriesPurities || [];

            // Save typed inputs to preserve them during re-renders
            const savedValues = {};
            for (let i = 0; i < purities.length; i++) {
                const ctM2 = document.getElementById(`input-ct-m2-${i}`);
                const bhavM2 = document.getElementById(`input-bhav-m2-${i}`);
                const ctP2 = document.getElementById(`input-ct-p2-${i}`);
                const bhavP2 = document.getElementById(`input-bhav-p2-${i}`);
                if (ctM2) savedValues[`ct-m2-${i}`] = ctM2.value;
                if (bhavM2) savedValues[`bhav-m2-${i}`] = bhavM2.value;
                if (ctP2) savedValues[`ct-p2-${i}`] = ctP2.value;
                if (bhavP2) savedValues[`bhav-p2-${i}`] = bhavP2.value;
            }

            let html = '';

            // Regular Group (Index 0 to 7)
            for (let i = 0; i < Math.min(8, purities.length); i++) {
                html += renderPurityRowHtml(purities[i], i);
            }

            // Subtotal Regular row
            html += `
            <tr style="background: #f0f0eb; font-weight: bold; border-top: 1.5px solid #a0a098; border-bottom: 1.5px solid #a0a098;">
                <td style="padding: 4px; border: 1px solid #b0b0a8; font-weight: bold; color: #002878;">Total Regular</td>
                <td id="subtotal-ct-m2-regular" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.000</td>
                <td id="subtotal-bhav-m2-regular" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">₹0</td>
                <td id="subtotal-pct-size-m2-regular" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.00%</td>
                <td id="subtotal-pct-ser-m2-regular" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.00%</td>
                <td id="subtotal-ct-p2-regular" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.000</td>
                <td id="subtotal-bhav-p2-regular" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">₹0</td>
                <td id="subtotal-pct-size-p2-regular" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.00%</td>
                <td id="subtotal-pct-ser-p2-regular" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.00%</td>
            </tr>
            `;

            // Extra Group (Index 8 onwards)
            for (let i = 8; i < purities.length; i++) {
                html += renderPurityRowHtml(purities[i], i);
            }

            // Subtotal Extra row
            html += `
            <tr style="background: #f0f0eb; font-weight: bold; border-top: 1.5px solid #a0a098; border-bottom: 1.5px solid #a0a098;">
                <td style="padding: 4px; border: 1px solid #b0b0a8; font-weight: bold; color: #002878;">Total Extra</td>
                <td id="subtotal-ct-m2-extra" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.000</td>
                <td id="subtotal-bhav-m2-extra" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">₹0</td>
                <td id="subtotal-pct-size-m2-extra" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.00%</td>
                <td id="subtotal-pct-ser-m2-extra" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.00%</td>
                <td id="subtotal-ct-p2-extra" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.000</td>
                <td id="subtotal-bhav-p2-extra" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">₹0</td>
                <td id="subtotal-pct-size-p2-extra" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.00%</td>
                <td id="subtotal-pct-ser-p2-extra" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace;">0.00%</td>
            </tr>
            `;

            tbody.innerHTML = html;

            // Restore saved values or load from localStorage
            for (let i = 0; i < purities.length; i++) {
                const ctM2 = document.getElementById(`input-ct-m2-${i}`);
                const bhavM2 = document.getElementById(`input-bhav-m2-${i}`);
                const ctP2 = document.getElementById(`input-ct-p2-${i}`);
                const bhavP2 = document.getElementById(`input-bhav-p2-${i}`);
                if (ctM2 && savedValues[`ct-m2-${i}`] !== undefined) ctM2.value = savedValues[`ct-m2-${i}`];
                if (bhavM2) {
                    if (savedValues[`bhav-m2-${i}`] !== undefined && savedValues[`bhav-m2-${i}`] !== "") {
                        bhavM2.value = savedValues[`bhav-m2-${i}`];
                    } else {
                        bhavM2.value = getStorageItem(`last-bhav--2-${purities[i]}`) || "";
                    }
                }
                if (ctP2 && savedValues[`ct-p2-${i}`] !== undefined) ctP2.value = savedValues[`ct-p2-${i}`];
                if (bhavP2) {
                    if (savedValues[`bhav-p2-${i}`] !== undefined && savedValues[`bhav-p2-${i}`] !== "") {
                        bhavP2.value = savedValues[`bhav-p2-${i}`];
                    } else {
                        bhavP2.value = getStorageItem(`last-bhav-+2-${purities[i]}`) || "";
                    }
                }
            }

            // Recalculate everything
            recalcSeriesWizardCalculations();
        }

        function renderPurityRowHtml(purity, i) {
            // Rates: always readonly, editable only via double-click + admin password
            // Pre-fill from localStorage
            const savedM2 = getStorageItem(`last-bhav--2-${purity}`) || '';
            const savedP2 = getStorageItem(`last-bhav-+2-${purity}`) || '';
            const bhavStyle = "background: #f0f4ff; color: #002878; cursor: default; font-weight: bold;";

            return `
            <tr class="purity-row" data-index="${i}">
                <td style="padding: 4px; border: 1px solid #b0b0a8; font-weight: bold; font-size:0.78rem; white-space:nowrap;">${purity}</td>
                <!-- -2 Sieve -->
                <td style="border: 1px solid #b0b0a8; padding: 2px; text-align: center;">
                    <input type="number" step="0.001" id="input-ct-m2-${i}" data-index="${i}" data-size="-2" class="opening-ct-input filter-input" style="width: 78px; text-align: right; font-size: 0.8rem; border: 1px solid #ccc; padding: 2px;" placeholder="0.000" oninput="recalcSeriesWizardCalculations()">
                </td>
                <td style="border: 1px solid #b0b0a8; padding: 2px; text-align: center;" title="Double-click to edit rate">
                    <input type="number" step="1" id="input-bhav-m2-${i}" data-index="${i}" data-size="-2" class="opening-bhav-input filter-input" style="width: 83px; text-align: right; font-size: 0.8rem; border: 1px solid #b0b0a8; padding: 2px; ${bhavStyle}" placeholder="Rate" value="${savedM2}" oninput="recalcSeriesWizardCalculations()" ondblclick="handleBhavDblClick(event)" readonly>
                </td>
                <td id="cell-pct-size-m2-${i}" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace; font-size: 0.75rem;">0.00%</td>
                <td id="cell-pct-ser-m2-${i}" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace; font-size: 0.75rem;">0.00%</td>
                <!-- +2 Sieve -->
                <td style="border: 1px solid #b0b0a8; padding: 2px; text-align: center;">
                    <input type="number" step="0.001" id="input-ct-p2-${i}" data-index="${i}" data-size="+2" class="opening-ct-input filter-input" style="width: 78px; text-align: right; font-size: 0.8rem; border: 1px solid #ccc; padding: 2px;" placeholder="0.000" oninput="recalcSeriesWizardCalculations()">
                </td>
                <td style="border: 1px solid #b0b0a8; padding: 2px; text-align: center;" title="Double-click to edit rate">
                    <input type="number" step="1" id="input-bhav-p2-${i}" data-index="${i}" data-size="+2" class="opening-bhav-input filter-input" style="width: 83px; text-align: right; font-size: 0.8rem; border: 1px solid #b0b0a8; padding: 2px; ${bhavStyle}" placeholder="Rate" value="${savedP2}" oninput="recalcSeriesWizardCalculations()" ondblclick="handleBhavDblClick(event)" readonly>
                </td>
                <td id="cell-pct-size-p2-${i}" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace; font-size: 0.75rem;">0.00%</td>
                <td id="cell-pct-ser-p2-${i}" style="border: 1px solid #b0b0a8; padding: 4px; text-align: right; font-family: monospace; font-size: 0.75rem;">0.00%</td>
            </tr>
            `;
        }

        function recalcSeriesWizardCalculations() {
            const purities = ERP_STATE.masters.seriesPurities || [];
            
            let ct_m2_reg = 0, amt_m2_reg = 0;
            let ct_p2_reg = 0, amt_p2_reg = 0;
            let ct_m2_ext = 0, amt_m2_ext = 0;
            let ct_p2_ext = 0, amt_p2_ext = 0;

            const rowData = [];

            // Read values for all purities
            for (let i = 0; i < purities.length; i++) {
                const ctM2El = document.getElementById(`input-ct-m2-${i}`);
                const bhavM2El = document.getElementById(`input-bhav-m2-${i}`);
                const ctP2El = document.getElementById(`input-ct-p2-${i}`);
                const bhavP2El = document.getElementById(`input-bhav-p2-${i}`);

                const ct_m2 = ctM2El ? (parseFloat(ctM2El.value) || 0) : 0;
                const bhav_m2 = bhavM2El ? (parseFloat(bhavM2El.value) || 0) : 0;
                const ct_p2 = ctP2El ? (parseFloat(ctP2El.value) || 0) : 0;
                const bhav_p2 = bhavP2El ? (parseFloat(bhavP2El.value) || 0) : 0;

                // Cache price edits in real-time
                if (bhavM2El && bhavM2El.value !== "") {
                    setStorageItem(`last-bhav--2-${purities[i]}`, bhavM2El.value);
                }
                if (bhavP2El && bhavP2El.value !== "") {
                    setStorageItem(`last-bhav-+2-${purities[i]}`, bhavP2El.value);
                }

                const amt_m2 = ct_m2 * bhav_m2;
                const amt_p2 = ct_p2 * bhav_p2;

                rowData.push({ ct_m2, bhav_m2, amt_m2, ct_p2, bhav_p2, amt_p2 });

                if (i < 8) {
                    // Regular Group
                    ct_m2_reg += ct_m2;
                    amt_m2_reg += amt_m2;
                    ct_p2_reg += ct_p2;
                    amt_p2_reg += amt_p2;
                } else {
                    // Extra Group
                    ct_m2_ext += ct_m2;
                    amt_m2_ext += amt_m2;
                    ct_p2_ext += ct_p2;
                    amt_p2_ext += amt_p2;
                }
            }

            const total_m2_cts = ct_m2_reg + ct_m2_ext;
            const total_p2_cts = ct_p2_reg + ct_p2_ext;
            const grand_total_cts = total_m2_cts + total_p2_cts;

            const total_m2_amt = amt_m2_reg + amt_m2_ext;
            const total_p2_amt = amt_p2_reg + amt_p2_ext;
            const grand_total_amt = total_m2_amt + total_p2_amt;

            // Update row % of size and % of series
            for (let i = 0; i < purities.length; i++) {
                const data = rowData[i];
                
                const cellPctSizeM2 = document.getElementById(`cell-pct-size-m2-${i}`);
                const cellPctSerM2 = document.getElementById(`cell-pct-ser-m2-${i}`);
                const cellPctSizeP2 = document.getElementById(`cell-pct-size-p2-${i}`);
                const cellPctSerP2 = document.getElementById(`cell-pct-ser-p2-${i}`);

                if (cellPctSizeM2) {
                    const pctSizeM2 = total_m2_cts > 0 ? (data.ct_m2 / total_m2_cts * 100) : 0;
                    cellPctSizeM2.innerText = pctSizeM2.toFixed(2) + "%";
                }
                if (cellPctSerM2) {
                    const pctSerM2 = grand_total_cts > 0 ? (data.ct_m2 / grand_total_cts * 100) : 0;
                    cellPctSerM2.innerText = pctSerM2.toFixed(2) + "%";
                }

                if (cellPctSizeP2) {
                    const pctSizeP2 = total_p2_cts > 0 ? (data.ct_p2 / total_p2_cts * 100) : 0;
                    cellPctSizeP2.innerText = pctSizeP2.toFixed(2) + "%";
                }
                if (cellPctSerP2) {
                    const pctSerP2 = grand_total_cts > 0 ? (data.ct_p2 / grand_total_cts * 100) : 0;
                    cellPctSerP2.innerText = pctSerP2.toFixed(2) + "%";
                }
            }

            // Update Subtotal Regular elements in DOM
            const subCtM2RegEl = document.getElementById('subtotal-ct-m2-regular');
            const subBhavM2RegEl = document.getElementById('subtotal-bhav-m2-regular');
            const subPctSizeM2RegEl = document.getElementById('subtotal-pct-size-m2-regular');
            const subPctSerM2RegEl = document.getElementById('subtotal-pct-ser-m2-regular');

            const subCtP2RegEl = document.getElementById('subtotal-ct-p2-regular');
            const subBhavP2RegEl = document.getElementById('subtotal-bhav-p2-regular');
            const subPctSizeP2RegEl = document.getElementById('subtotal-pct-size-p2-regular');
            const subPctSerP2RegEl = document.getElementById('subtotal-pct-ser-p2-regular');

            if (subCtM2RegEl) subCtM2RegEl.innerText = ct_m2_reg.toFixed(3);
            if (subBhavM2RegEl) {
                const avgBhavM2Reg = ct_m2_reg > 0 ? Math.round(amt_m2_reg / ct_m2_reg) : 0;
                subBhavM2RegEl.innerText = "₹" + avgBhavM2Reg.toLocaleString();
            }
            if (subPctSizeM2RegEl) {
                const pctSizeM2Reg = total_m2_cts > 0 ? (ct_m2_reg / total_m2_cts * 100) : 0;
                subPctSizeM2RegEl.innerText = pctSizeM2Reg.toFixed(2) + "%";
            }
            if (subPctSerM2RegEl) {
                const pctSerM2Reg = grand_total_cts > 0 ? (ct_m2_reg / grand_total_cts * 100) : 0;
                subPctSerM2RegEl.innerText = pctSerM2Reg.toFixed(2) + "%";
            }

            if (subCtP2RegEl) subCtP2RegEl.innerText = ct_p2_reg.toFixed(3);
            if (subBhavP2RegEl) {
                const avgBhavP2Reg = ct_p2_reg > 0 ? Math.round(amt_p2_reg / ct_p2_reg) : 0;
                subBhavP2RegEl.innerText = "₹" + avgBhavP2Reg.toLocaleString();
            }
            if (subPctSizeP2RegEl) {
                const pctSizeP2Reg = total_p2_cts > 0 ? (ct_p2_reg / total_p2_cts * 100) : 0;
                subPctSizeP2RegEl.innerText = pctSizeP2Reg.toFixed(2) + "%";
            }
            if (subPctSerP2RegEl) {
                const pctSerP2Reg = grand_total_cts > 0 ? (ct_p2_reg / grand_total_cts * 100) : 0;
                subPctSerP2RegEl.innerText = pctSerP2Reg.toFixed(2) + "%";
            }

            // Update Subtotal Extra elements in DOM
            const subCtM2ExtEl = document.getElementById('subtotal-ct-m2-extra');
            const subBhavM2ExtEl = document.getElementById('subtotal-bhav-m2-extra');
            const subPctSizeM2ExtEl = document.getElementById('subtotal-pct-size-m2-extra');
            const subPctSerM2ExtEl = document.getElementById('subtotal-pct-ser-m2-extra');

            const subCtP2ExtEl = document.getElementById('subtotal-ct-p2-extra');
            const subBhavP2ExtEl = document.getElementById('subtotal-bhav-p2-extra');
            const subPctSizeP2ExtEl = document.getElementById('subtotal-pct-size-p2-extra');
            const subPctSerP2ExtEl = document.getElementById('subtotal-pct-ser-p2-extra');

            if (subCtM2ExtEl) subCtM2ExtEl.innerText = ct_m2_ext.toFixed(3);
            if (subBhavM2ExtEl) {
                const avgBhavM2Ext = ct_m2_ext > 0 ? Math.round(amt_m2_ext / ct_m2_ext) : 0;
                subBhavM2ExtEl.innerText = "₹" + avgBhavM2Ext.toLocaleString();
            }
            if (subPctSizeM2ExtEl) {
                const pctSizeM2Ext = total_m2_cts > 0 ? (ct_m2_ext / total_m2_cts * 100) : 0;
                subPctSizeM2ExtEl.innerText = pctSizeM2Ext.toFixed(2) + "%";
            }
            if (subPctSerM2ExtEl) {
                const pctSerM2Ext = grand_total_cts > 0 ? (ct_m2_ext / grand_total_cts * 100) : 0;
                subPctSerM2ExtEl.innerText = pctSerM2Ext.toFixed(2) + "%";
            }

            if (subCtP2ExtEl) subCtP2ExtEl.innerText = ct_p2_ext.toFixed(3);
            if (subBhavP2ExtEl) {
                const avgBhavP2Ext = ct_p2_ext > 0 ? Math.round(amt_p2_ext / ct_p2_ext) : 0;
                subBhavP2ExtEl.innerText = "₹" + avgBhavP2Ext.toLocaleString();
            }
            if (subPctSizeP2ExtEl) {
                const pctSizeP2Ext = total_p2_cts > 0 ? (ct_p2_ext / total_p2_cts * 100) : 0;
                subPctSizeP2ExtEl.innerText = pctSizeP2Ext.toFixed(2) + "%";
            }
            if (subPctSerP2ExtEl) {
                const pctSerP2Ext = grand_total_cts > 0 ? (ct_p2_ext / grand_total_cts * 100) : 0;
                subPctSerP2ExtEl.innerText = pctSerP2Ext.toFixed(2) + "%";
            }

            // Update Left Side Summary Box
            const seriesTotalCtsEl = document.getElementById('opening-series-total-cts');
            const seriesAvgBhavEl = document.getElementById('opening-series-avg-bhav');

            if (seriesTotalCtsEl) seriesTotalCtsEl.innerText = grand_total_cts.toFixed(3);
            if (seriesAvgBhavEl) {
                const grand_avg_bhav = grand_total_cts > 0 ? Math.round(grand_total_amt / grand_total_cts) : 0;
                seriesAvgBhavEl.innerText = "₹" + grand_avg_bhav.toLocaleString();
            }

            // Update Right Side Total Avg Summary Table
            const sumCtM2 = document.getElementById('opening-summary-cts-m2');
            const sumBhavM2 = document.getElementById('opening-summary-bhav-m2');
            const sumPctM2 = document.getElementById('opening-summary-pct-m2');

            const sumCtP2 = document.getElementById('opening-summary-cts-p2');
            const sumBhavP2 = document.getElementById('opening-summary-bhav-p2');
            const sumPctP2 = document.getElementById('opening-summary-pct-p2');

            const sumCtM2Ex = document.getElementById('opening-summary-cts-m2-ex');
            const sumBhavM2Ex = document.getElementById('opening-summary-bhav-m2-ex');
            const sumPctM2Ex = document.getElementById('opening-summary-pct-m2-ex');

            const sumCtP2Ex = document.getElementById('opening-summary-cts-p2-ex');
            const sumBhavP2Ex = document.getElementById('opening-summary-bhav-p2-ex');
            const sumPctP2Ex = document.getElementById('opening-summary-pct-p2-ex');

            const sumCtGrand = document.getElementById('opening-summary-cts-grand');
            const sumBhavGrand = document.getElementById('opening-summary-bhav-grand');
            const sumPctGrand = document.getElementById('opening-summary-pct-grand');

            // (-2) Regular
            if (sumCtM2) sumCtM2.innerText = ct_m2_reg.toFixed(3);
            if (sumBhavM2) {
                const avg = ct_m2_reg > 0 ? Math.round(amt_m2_reg / ct_m2_reg) : 0;
                sumBhavM2.innerText = "₹" + avg.toLocaleString();
            }
            if (sumPctM2) {
                const pct = grand_total_cts > 0 ? (ct_m2_reg / grand_total_cts * 100) : 0;
                sumPctM2.innerText = pct.toFixed(2) + "%";
            }

            // (+2) Regular
            if (sumCtP2) sumCtP2.innerText = ct_p2_reg.toFixed(3);
            if (sumBhavP2) {
                const avg = ct_p2_reg > 0 ? Math.round(amt_p2_reg / ct_p2_reg) : 0;
                sumBhavP2.innerText = "₹" + avg.toLocaleString();
            }
            if (sumPctP2) {
                const pct = grand_total_cts > 0 ? (ct_p2_reg / grand_total_cts * 100) : 0;
                sumPctP2.innerText = pct.toFixed(2) + "%";
            }

            // (-2 EX) Extra
            if (sumCtM2Ex) sumCtM2Ex.innerText = ct_m2_ext.toFixed(3);
            if (sumBhavM2Ex) {
                const avg = ct_m2_ext > 0 ? Math.round(amt_m2_ext / ct_m2_ext) : 0;
                sumBhavM2Ex.innerText = "₹" + avg.toLocaleString();
            }
            if (sumPctM2Ex) {
                const pct = grand_total_cts > 0 ? (ct_m2_ext / grand_total_cts * 100) : 0;
                sumPctM2Ex.innerText = pct.toFixed(2) + "%";
            }

            // (+2 EX) Extra
            if (sumCtP2Ex) sumCtP2Ex.innerText = ct_p2_ext.toFixed(3);
            if (sumBhavP2Ex) {
                const avg = ct_p2_ext > 0 ? Math.round(amt_p2_ext / ct_p2_ext) : 0;
                sumBhavP2Ex.innerText = "₹" + avg.toLocaleString();
            }
            if (sumPctP2Ex) {
                const pct = grand_total_cts > 0 ? (ct_p2_ext / grand_total_cts * 100) : 0;
                sumPctP2Ex.innerText = pct.toFixed(2) + "%";
            }

            // Grand Total
            if (sumCtGrand) sumCtGrand.innerText = grand_total_cts.toFixed(3);
            if (sumBhavGrand) {
                const avg = grand_total_cts > 0 ? Math.round(grand_total_amt / grand_total_cts) : 0;
                sumBhavGrand.innerText = "₹" + avg.toLocaleString();
            }
            if (sumPctGrand) {
                sumPctGrand.innerText = "100.00%";
            }

            // Validation check against source stock
            const selectedPurity = document.getElementById('opening-source-purity').value;
            if (selectedPurity) {
                const mixEl = document.getElementById('opening-src-avail-mix');
                const availMIX = mixEl ? (parseFloat(mixEl.innerText) || 0) : 0;
                const warningEl = document.getElementById('opening-unsplit-warning');
                if (warningEl) {
                    if (grand_total_cts > availMIX) {
                        warningEl.style.display = 'block';
                    } else {
                        warningEl.style.display = 'none';
                    }
                }
            }
        }

        function commitSeriesStockDivision() {
            const series = document.getElementById('opening-series-name').value.trim();
            const date = document.getElementById('opening-date').value;
            const sourcePurity = document.getElementById('opening-source-purity').value;

            const color = document.getElementById('opening-color').value.trim().toUpperCase() || 'White';

            if (!series || !date || !sourcePurity) {
                showCustomAlert("Validation Error", "Please select Date, Series Name, and Source Stock Purity first.", "warning");
                return;
            }

            const keyMix = `${color}||MIX||${sourcePurity}`;
            const availMix = ERP_STATE.stock[keyMix] || 0;

            const purities = ERP_STATE.masters.seriesPurities || [];
            const targets = [];
            let total_m2_split = 0;
            let total_p2_split = 0;

            let rateCheckFailed = false;

            for (let i = 0; i < purities.length; i++) {
                const ctM2El = document.getElementById(`input-ct-m2-${i}`);
                const bhavM2El = document.getElementById(`input-bhav-m2-${i}`);
                const ctP2El = document.getElementById(`input-ct-p2-${i}`);
                const bhavP2El = document.getElementById(`input-bhav-p2-${i}`);

                const ct_m2 = ctM2El ? (parseFloat(ctM2El.value) || 0) : 0;
                const bhav_m2 = bhavM2El ? (parseFloat(bhavM2El.value) || 0) : 0;
                const ct_p2 = ctP2El ? (parseFloat(ctP2El.value) || 0) : 0;
                const bhav_p2 = bhavP2El ? (parseFloat(bhavP2El.value) || 0) : 0;

                if (ct_m2 > 0) {
                    if (bhav_m2 <= 0) rateCheckFailed = true;
                    total_m2_split += ct_m2;
                    targets.push({ size: "-2", purity: purities[i], cts: ct_m2, rate: bhav_m2 });
                }
                if (ct_p2 > 0) {
                    if (bhav_p2 <= 0) rateCheckFailed = true;
                    total_p2_split += ct_p2;
                    targets.push({ size: "+2", purity: purities[i], cts: ct_p2, rate: bhav_p2 });
                }
            }

            if (targets.length === 0) {
                showCustomAlert("Validation Error", "Please enter at least one carat weight > 0 to divide.", "warning");
                return;
            }

            if (rateCheckFailed) {
                showCustomAlert("Validation Error", "Please enter a rate (Bhav) greater than 0 for all categories that have carats split.", "warning");
                return;
            }

            const totalSplit = total_m2_split + total_p2_split;
            if (totalSplit > availMix) {
                showCustomAlert("Split Blocked", `Error: Split carats exceed available MIX stock of selected source lot [${sourcePurity}].\n\n` +
                      `Requested split vs available:\n` +
                      `Total split: ${totalSplit.toFixed(3)} Cts (Available MIX: ${availMix.toFixed(3)})`, "error");
                return;
            }

            const confirmMsg = `Are you sure you want to divide stock from MIX lot [${sourcePurity}]?\n\n` +
                               `Deductions from [${sourcePurity}] MIX:\n` +
                               `- Total carats: ${totalSplit.toFixed(3)} Cts (-2: ${total_m2_split.toFixed(3)}, +2: ${total_p2_split.toFixed(3)})\n\n` +
                               `Additions to target lots under Series: [${series}].`;

            showCustomConfirm('Confirm Division', confirmMsg, () => {
                // Perform deductions from MIX lot
                ERP_STATE.stock[keyMix] = Math.max(0, availMix - totalSplit);

                // Perform additions to target sieve sizes
                targets.forEach(t => {
                    const key = `${color}||${t.size}||${t.purity}`;
                    ERP_STATE.stock[key] = (ERP_STATE.stock[key] || 0) + t.cts;
                });

                // Audit logging: Purchase logs for additions, Sales logs for deductions
                const avgRateMix = getWeightedAveragePurchaseRate(sourcePurity, "MIX", color) || 2400;
                const totalAmtDeducted = totalSplit * avgRateMix;

                ERP_STATE.salesLog.unshift({
                    invoice: `${series}-DED`,
                    date: date,
                    party: "Series Division Deduction",
                    broker: "Direct Trading (No Broker)",
                    color: color,
                    size: "MIX",
                    clarity: sourcePurity,
                    carats: totalSplit,
                    rate: avgRateMix,
                    amount: totalAmtDeducted,
                    remark: `Deduction for Series ${series}`
                });

                if (totalAmtDeducted > 0) {
                    ERP_STATE.invoiceMetadata[`${series}-DED`] = {
                        branch: "MUMBAI", memoNo: "", rsType: "Rs", exRt: 1.0, exRt2: 1.0, payExRt: 1.0,
                        party: "Series Division Deduction", broker: "Direct Trading (No Broker)", pType: "REGULAR",
                        invExp: 0, addLess1: 0, addLess2: 0, deduction: 0, brokerage: 0, days: 0, dDate: date, lateDays: 0,
                        expPct: 0, expense: 0, roundOf: 0, amount: totalAmtDeducted, round: 0, total: totalAmtDeducted, totalRs: totalAmtDeducted,
                        status: "DONE", type: "CASH", isGia: "No", noti: `Deduction from ${sourcePurity} MIX`
                    };
                }

                let totalAmtAdded = 0;
                targets.forEach(t => {
                    const amt = t.cts * t.rate;
                    totalAmtAdded += amt;
                    ERP_STATE.purchaseLog.unshift({
                        invoice: series,
                        date: date,
                        party: "Series Division Addition",
                        broker: "Direct Trading (No Broker)",
                        color: color,
                        size: t.size,
                        clarity: t.purity,
                        carats: t.cts,
                        rate: t.rate,
                        amount: amt,
                        remark: `Addition from ${sourcePurity} MIX split`
                    });
                });

                if (totalAmtAdded > 0) {
                    ERP_STATE.invoiceMetadata[series] = {
                        branch: "MUMBAI", memoNo: "", rsType: "Rs", exRt: 1.0, exRt2: 1.0, payExRt: 1.0,
                        party: "Series Division Addition", broker: "Direct Trading (No Broker)", pType: "REGULAR",
                        invExp: 0, addLess1: 0, addLess2: 0, deduction: 0, brokerage: 0, days: 0, dDate: date, lateDays: 0,
                        expPct: 0, expense: 0, roundOf: 0, amount: totalAmtAdded, round: 0, total: totalAmtAdded, totalRs: totalAmtAdded,
                        status: "DONE", type: "CASH", isGia: "No", noti: `Division into Series ${series}`
                    };
                }

                // Rojmel log
                ERP_STATE.rojmel.unshift({
                    time: `${date} Division`,
                    type: "MIX",
                    msg: `Divided ${sourcePurity} MIX Lot (${totalSplit.toFixed(3)} Cts) into Series [${series}]`,
                    delta: `-${totalSplit.toFixed(3)} Cts (MIX) / +${totalSplit.toFixed(3)} Cts (-2/+2)`
                });

                // Clear inputs
                for (let i = 0; i < purities.length; i++) {
                    const ctM2El = document.getElementById(`input-ct-m2-${i}`);
                    const bhavM2El = document.getElementById(`input-bhav-m2-${i}`);
                    const ctP2El = document.getElementById(`input-ct-p2-${i}`);
                    const bhavP2El = document.getElementById(`input-bhav-p2-${i}`);
                    if (ctM2El) ctM2El.value = "";
                    if (bhavM2El) bhavM2El.value = "";
                    if (ctP2El) ctP2El.value = "";
                    if (bhavP2El) bhavP2El.value = "";
                }
                
                // Set next series name default
                const match = series.match(/^(SERIES-\d+-)([A-Z]+)$/);
                if (match) {
                    const prefix = match[1];
                    const charCode = match[2].charCodeAt(0);
                    const nextChar = String.fromCharCode(charCode + 1);
                    document.getElementById('opening-series-name').value = `${prefix}${nextChar}`;
                } else {
                    document.getElementById('opening-series-name').value = "";
                }

                document.getElementById('opening-source-purity').value = "";

                // Re-lock rates upon committing division
                ERP_STATE.priceEditingUnlocked = false;
                const btnUnlock = document.getElementById('btn-unlock-rates');
                if (btnUnlock) {
                    btnUnlock.innerText = "🔒 Bhav Locked";
                    btnUnlock.className = "btn btn-secondary";
                }

                // Recalculate wizard display back to zero
                recalcSeriesWizardCalculations();

                saveDatabaseState();
                renderAllDataComponents();
                updateOpeningSourceStock();

                showCustomAlert("Success", `Success: Division of MIX lot [${sourcePurity}] completed successfully.\nDeducted ${totalSplit.toFixed(3)} Cts and added to target Series [${series}].`, "success", () => {
                    switchView('view-stock');
                });
            });
        }

        function addMasterItem(type) {
            const val = document.getElementById(`new-${type}-name`).value.trim().toUpperCase();
            if(!val) return;
            
            if(type === 'shade') ERP_STATE.masters.colors.push(val);
            if(type === 'purity') ERP_STATE.masters.purities.push(val);
            if(type === 'number') ERP_STATE.masters.numbers.push(val);
            if(type === 'size') ERP_STATE.masters.sizes.push(val);
            if(type === 'party') ERP_STATE.masters.parties.push(val);
            if(type === 'broker') ERP_STATE.masters.brokers.push(val);

            document.getElementById(`new-${type}-name`).value = "";
            saveDatabaseState();
            refreshAllMasterSelectors();
            renderAllDataComponents();
            showCustomAlert("Success", `Registered ${val} directly inside structural master profiles registry tables.`, "success");
        }

        function deleteMasterItem(type) {
            const sel = document.getElementById(`delete-${type}`);
            const value = sel?.value;
            if (!value) return;
            showCustomConfirm('Delete Master Item', `Delete "${value}" from ${type} list?`, () => {
                const arr = ERP_STATE.masters[type === 'shade' ? 'colors' : type === 'purity' ? 'purities' : type === 'number' ? 'numbers' : type + 's'];
                const idx = arr.indexOf(value);
                if (idx === -1) return;
                arr.splice(idx, 1);
                saveDatabaseState();
                refreshAllMasterSelectors();
                renderAllDataComponents();
            }, null, 'danger');
        }

        // Render Pipelines View Adapters
        function renderAllDataComponents() {
            renderPurchaseTable();
            renderSalesTable();
            renderStockTable();
            renderRojmelTable();
            renderPaymentVoucherTable();
            renderPaymentIRTable();
            renderMasterLists();
            renderOpeningWizardTable();
            renderAssortmentApp();
            updateAnalyticsCharts();
            // Re-render audit log if its view is active
            const activeView = document.querySelector('.app-view.active-view');
            if (activeView && activeView.id === 'view-reports-log') {
                const activeBtn = document.querySelector('#view-reports-log .erp-tab-btn.active');
                const tab = activeBtn ? activeBtn.id.replace('btn-audit-', '').toUpperCase() : 'PURCHASE';
                renderReportsAuditLogTable(tab);
            }
        }

        function renderPurchaseTable() {
            renderLedger('pur');
        }

        function renderSalesTable() {
            renderLedger('sale');
            renderReportTables();
            updateMixSourceAvailable();
        }

        function getAveragePurchaseRate(size, purity) {
            let totalAmt = 0;
            let totalCts = 0;
            const normSize = (size || "").replace(/ Sieve| size/gi, '').trim().toUpperCase();
            const normPurity = (purity || "").trim().toUpperCase();
            ERP_STATE.purchaseLog.forEach(l => {
                const cleanLogSize = (l.size || "").replace(/ Sieve| size/gi, '').trim().toUpperCase();
                if (cleanLogSize === normSize && (l.clarity || "").trim().toUpperCase() === normPurity) {
                    totalAmt += l.amount;
                    totalCts += l.carats;
                }
            });
            if (totalCts > 0) {
                return totalAmt / totalCts;
            }
            // Dynamic Seed Catalog Averages
            const normPurityPlain = normPurity.replace(/\s+/g, '');
            if (normPurityPlain === 'WH1' && normSize === '-2') return 2200;
            if (normPurityPlain === 'WH2' && normSize === '-2') return 1900;
            if (normPurityPlain === 'WH1' && normSize === '+2') return 3100;
            if (normPurityPlain === 'FANCY' && normSize === '+2') return 4500;
            return 2400;
        }

        function getLastPurchaseNote(size, purity, color) {
            const normSize = (size || "").replace(/ Sieve| size/gi, '').trim().toUpperCase();
            const normPurity = (purity || "").trim().toUpperCase();
            const normColor = (color || "White").trim().toUpperCase();
            const log = ERP_STATE.purchaseLog || [];
            for (const l of log) {
                const logSize = (l.size || "").replace(/ Sieve| size/gi, '').trim().toUpperCase();
                if (logSize === normSize &&
                    (l.clarity || "").trim().toUpperCase() === normPurity &&
                    (l.color || "White").trim().toUpperCase() === normColor) {
                    return l.remark || "";
                }
            }
            return "";
        }

        function renderStockTable() {
            const body = document.getElementById('stock-ledger-table');
            if (!body) return;

            const thead = document.getElementById('stock-ledger-thead');
            const sizes = ERP_STATE.masters.sizes;
            const numbers = ERP_STATE.masters.numbers;

            if (thead) {
                thead.innerHTML = `
                    <tr>
                        <th style="padding: 6px; border: 1px solid #b0b0a8; width: 60px;">Sieve</th>
                        <th style="padding: 6px; border: 1px solid #b0b0a8; width: 120px;">Clarity / Purity Group</th>
                        <th style="text-align: right; border: 1px solid #b0b0a8; padding: 6px; width: 90px;">Carats</th>
                        <th style="text-align: right; border: 1px solid #b0b0a8; padding: 6px; width: 100px;">Avg Rate</th>
                        <th style="text-align: right; border: 1px solid #b0b0a8; padding: 6px; width: 120px;">Total Value</th>
                        <th style="padding: 6px; border: 1px solid #b0b0a8;">Note</th>
                    </tr>
                `;
            }

            const fColor = document.getElementById('stock-filter-color') ? document.getElementById('stock-filter-color').value.toLowerCase() : "";
            const fPurity = document.getElementById('stock-filter-purity') ? document.getElementById('stock-filter-purity').value.toLowerCase() : "";

            let totalCaratsAccum = 0;
            let totalValueAccum = 0;
            let html = "";

            sizes.forEach(size => {
                numbers.forEach(number => {
                    if (fPurity && !number.toLowerCase().includes(fPurity)) return;

                    let matchedColor = "White";
                    let carats = 0;
                    for (const [key, qty] of Object.entries(ERP_STATE.stock)) {
                        const [col, sz, pur] = key.split('||');
                        const cleanSz = sz.replace(/ Sieve| size/gi, '').trim().toUpperCase();
                        const targetCleanSz = size.replace(/ Sieve| size/gi, '').trim().toUpperCase();
                        if (cleanSz === targetCleanSz && pur.trim().toUpperCase() === number.trim().toUpperCase()) {
                            if (fColor && !col.toLowerCase().includes(fColor)) continue;
                            carats += qty;
                            matchedColor = col;
                        }
                    }

                    if (carats <= 0.0001) return;

                    let avgRate = 0;
                    if (size === 'MIX') {
                        avgRate = getWeightedAveragePurchaseRate(number, 'MIX', matchedColor) || getAveragePurchaseRate('MIX', number);
                    } else {
                        avgRate = getWeightedAveragePurchaseRate(number, size, matchedColor) || getAveragePurchaseRate(size, number);
                    }
                    const totalVal = carats * avgRate;

                    totalCaratsAccum += carats;
                    totalValueAccum += totalVal;

                    const note = getLastPurchaseNote(size, number, matchedColor);

                    html += `
                        <tr>
                            <td style="font-weight: bold; color: #002878; border-right: 1px solid var(--border); text-align: center;">${size}</td>
                            <td><span style="background:rgba(0,0,0,0.04); padding:3px 8px; border-radius:4px; font-weight:600;">${number}</span></td>
                            <td style="text-align: right;">${carats.toFixed(2)}</td>
                            <td style="text-align: right;">₹${Math.round(avgRate).toLocaleString('en-IN')}</td>
                            <td style="text-align: right; font-weight: 700;">₹${Math.round(totalVal).toLocaleString('en-IN')}</td>
                            <td style="font-size: 0.75rem; color: var(--text-muted); padding: 4px 6px;">${note}</td>
                        </tr>
                    `;
                });
            });

            if (html) {
                const avgRateAccum = totalCaratsAccum > 0 ? (totalValueAccum / totalCaratsAccum) : 0;
                html += `
                    <tr style="font-weight: bold; background: #e0e0d8; border-top: 2.5px solid var(--border);">
                        <td colspan="2" style="font-weight: bold; color: #002878; text-align: left;"><strong>TOTAL / SUB-TOTAL</strong></td>
                        <td style="text-align: right; font-weight: bold;">${totalCaratsAccum.toFixed(2)}</td>
                        <td style="text-align: right; font-weight: bold;">₹${Math.round(avgRateAccum).toLocaleString('en-IN')}</td>
                        <td style="text-align: right; font-weight: bold; color: #002878;">₹${Math.round(totalValueAccum).toLocaleString('en-IN')}</td>
                        <td></td>
                    </tr>
                `;
            }

            const colCount = 6;
            body.innerHTML = html || `<tr><td colspan="${colCount}" style="text-align:center; color:var(--text-muted);">No Tijori balances match active filters.</td></tr>`;

            if (document.getElementById('dash-total-carats')) {
                document.getElementById('dash-total-carats').innerText = `${totalCaratsAccum.toFixed(2)} Cts`;
            }
            if (document.getElementById('dash-total-value')) {
                document.getElementById('dash-total-value').innerText = `₹${Math.round(totalValueAccum).toLocaleString('en-IN')}`;
            }
            if (document.getElementById('stock-sieve-groups')) {
                document.getElementById('stock-sieve-groups').innerText = sizes.join(' / ');
            }
        }

        // Inline Modal Overlay Quick Vault Handlers
        let activeQuickSelectId = null;

        function handleQuickMasterChange(selectId, type) {
            const select = document.getElementById(selectId);
            if (!select) return;
            if (select.value === '+ Add New Party' || select.value === '+ Add New Broker') {
                if (select.dataset.arrowNav === 'true') {
                    select.dataset.arrowNav = 'false';
                    return;
                }
                activeQuickSelectId = selectId;
                openQuickMasterModal(type);
            }
        }

        function trackSelectKeydown(event, selectId) {
            const select = document.getElementById(selectId);
            if (!select) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                select.dataset.arrowNav = 'true';
            } else if (event.key === 'Enter') {
                select.dataset.arrowNav = 'false';
            }
        }

        function openQuickMasterModal(type, selectId) {
            activeQuickSelectId = selectId || activeQuickSelectId;
            let displayTitle = `Add New ${type.toUpperCase()}`;
            let displayLabel = `${type.toUpperCase()} Name`;
            if (type === 'party') {
                displayTitle = 'Add New Party';
                displayLabel = 'Party Name';
            } else if (type === 'broker') {
                displayTitle = 'Add New Broker';
                displayLabel = 'Broker Name';
            } else if (type === 'shade') {
                displayTitle = 'Add New Shade';
                displayLabel = 'Shade / Color Name';
            } else if (type === 'size') {
                displayTitle = 'Add New Size';
                displayLabel = 'Size Name';
            } else if (type === 'number') {
                displayTitle = 'Add New Number';
                displayLabel = 'Number / Purity Name';
            }
            document.getElementById('quick-master-title').innerText = displayTitle;
            document.getElementById('quick-master-label').innerText = displayLabel;
            document.getElementById('quick-master-input').value = "";
            document.getElementById('modal-overlay').style.display = 'block';
            document.getElementById('quick-master-modal').style.display = 'block';
            
            const input = document.getElementById('quick-master-input');
            input.focus();
            
            input.onkeydown = null;
            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveQuickMasterItem();
                }
            };
        }

        function closeQuickMasterModal() {
            document.getElementById('modal-overlay').style.display = 'none';
            document.getElementById('quick-master-modal').style.display = 'none';
            if (activeQuickSelectId) {
                const select = document.getElementById(activeQuickSelectId);
                if (select) {
                    select.value = "";
                    select.focus();
                }
            }
        }

        function saveQuickMasterItem() {
            const val = document.getElementById('quick-master-input').value.trim().toUpperCase();
            if (!val) return;

            if (activeQuickSelectId.includes('party')) {
                ERP_STATE.masters.parties.push(val);
            } else if (activeQuickSelectId.includes('broker')) {
                ERP_STATE.masters.brokers.push(val);
            } else if (activeQuickSelectId.includes('shade')) {
                ERP_STATE.masters.colors.push(val);
            } else if (activeQuickSelectId.includes('size')) {
                ERP_STATE.masters.sizes.push(val);
            } else if (activeQuickSelectId.includes('number')) {
                ERP_STATE.masters.numbers.push(val);
                if (!ERP_STATE.masters.purities.includes(val)) {
                    ERP_STATE.masters.purities.push(val);
                }
            }

            refreshAllMasterSelectors();
            saveDatabaseState();
            renderAllDataComponents();

            document.getElementById('modal-overlay').style.display = 'none';
            document.getElementById('quick-master-modal').style.display = 'none';

            const select = document.getElementById(activeQuickSelectId);
            if (select) {
                select.value = val;
                select.dispatchEvent(new Event('change'));
                
                // Auto-advance cursor to avoid re-opening the lookup menu
                if (activeQuickSelectId === 'pur-form-party') {
                    focusAndOpenMenu('pur-form-broker', 'broker');
                } else if (activeQuickSelectId === 'pur-form-broker') {
                    const daysField = document.getElementById('pur-form-days');
                    if (daysField) daysField.focus();
                } else if (activeQuickSelectId === 'sale-form-party') {
                    focusAndOpenMenu('sale-form-broker', 'broker');
                } else if (activeQuickSelectId === 'sale-form-broker') {
                    if (val && val !== '+ Add New Broker') {
                        openStockPicker();
                    }
                } else if (activeQuickSelectId === 'pur-sheet-shade') {
                    focusAndOpenMenu('pur-sheet-size', 'size');
                } else if (activeQuickSelectId === 'pur-sheet-size') {
                    focusAndOpenMenu('pur-sheet-number', 'number');
                } else if (activeQuickSelectId === 'pur-sheet-number') {
                    const caratsField = document.getElementById('pur-sheet-carats');
                    if (caratsField) caratsField.focus();
                } else {
                    select.focus();
                }
            }
            activeQuickSelectId = null;
        }



        // Report Master Tab & Multi-tier filters logic
        const REPORT_FILTERS = { StartDate: null, EndDate: null, Party: null, Broker: null, Size: null, Purity: null };
        let activeReportTab = 'purchase';

        function switchReportTab(tab) {
            activeReportTab = tab;
            const btnPur = document.getElementById('btn-rep-purchase');
            const btnSale = document.getElementById('btn-rep-sales');
            const panelPur = document.getElementById('rep-purchase-panel');
            const panelSale = document.getElementById('rep-sales-panel');

            if (tab === 'purchase') {
                if (btnPur) btnPur.className = 'erp-tab-btn active';
                if (btnSale) btnSale.className = 'erp-tab-btn';
                if (panelPur) panelPur.style.display = 'block';
                if (panelSale) panelSale.style.display = 'none';
            } else {
                if (btnSale) btnSale.className = 'erp-tab-btn active';
                if (btnPur) btnPur.className = 'erp-tab-btn';
                if (panelPur) panelPur.style.display = 'none';
                if (panelSale) panelSale.style.display = 'block';
            }
            renderReportTables();
        }

        function addReportFilter(type, value) {
            if (!value) return;
            REPORT_FILTERS[type] = value;
            renderReportPills();
            renderReportTables();
            
            // Reset select dropdown value to default
            const el = document.getElementById(`filter-${type.toLowerCase()}`);
            if (el) el.value = "";
        }

        function removeReportFilter(type) {
            REPORT_FILTERS[type] = null;
            if (type === 'StartDate') document.getElementById('filter-start-date').value = "";
            if (type === 'EndDate') document.getElementById('filter-end-date').value = "";
            renderReportPills();
            renderReportTables();
        }

        function renderReportPills() {
            const container = document.getElementById('filter-pills-container');
            if (!container) return;

            let html = "";
            for (const [type, val] of Object.entries(REPORT_FILTERS)) {
                if (val) {
                    html += `
                        <span style="background: #e0e0d8; border: 1px solid #b0b0a8; color: #333; font-weight:bold; font-size:0.75rem; padding:2px 8px; border-radius:3px; display:inline-flex; align-items:center; gap:6px; margin-right: 4px;">
                            ${type}: ${val}
                            <span style="cursor:pointer; color:var(--danger-color); font-weight:bold; font-size:0.85rem;" onclick="removeReportFilter('${type}')">✖</span>
                        </span>
                    `;
                }
            }
            container.innerHTML = html;
        }

        function renderReportTables() {
            const purBody = document.getElementById('rep-purchase-body');
            const saleBody = document.getElementById('rep-sales-body');
            if (!purBody || !saleBody) return;

            const start = REPORT_FILTERS.StartDate ? new Date(REPORT_FILTERS.StartDate) : null;
            const end = REPORT_FILTERS.EndDate ? new Date(REPORT_FILTERS.EndDate) : null;

            // Filter purchases
            const filteredPurchases = ERP_STATE.purchaseLog.filter(l => {
                if (start && new Date(l.date) < start) return false;
                if (end && new Date(l.date) > end) return false;
                if (REPORT_FILTERS.Party && l.party !== REPORT_FILTERS.Party) return false;
                if (REPORT_FILTERS.Broker && l.broker !== REPORT_FILTERS.Broker) return false;
                
                const cleanLogSize = (l.size || '').toString().replace(/ Sieve| size/gi, '').trim().toUpperCase();
                const cleanFilterSize = REPORT_FILTERS.Size ? REPORT_FILTERS.Size.toString().replace(/ Sieve| size/gi, '').trim().toUpperCase() : '';
                if (REPORT_FILTERS.Size && cleanLogSize !== cleanFilterSize) return false;
                
                if (REPORT_FILTERS.Purity && l.clarity !== REPORT_FILTERS.Purity) return false;
                return true;
            });

            purBody.innerHTML = filteredPurchases.map(l => `
                <tr>
                    <td><strong>${l.invoice || ''}</strong></td>
                    <td>${l.date || ''}</td>
                    <td>${l.party || ''}</td>
                    <td>${l.broker || ''}</td>
                    <td><span style="font-size:0.8rem; color:var(--text-muted);">${l.color || ''} | ${l.size || ''} | ${l.clarity || ''}</span></td>
                    <td style="text-align: right;">${Number(l.carats || 0).toFixed(3)} Cts</td>
                    <td style="text-align: right;">₹${Number(l.rate || 0).toLocaleString('en-IN')}</td>
                    <td style="text-align: right; font-weight:700;">₹${Number(l.amount || 0).toLocaleString('en-IN')}</td>
                </tr>
            `).join('') || `<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">No purchase entries match active report filters.</td></tr>`;

            // Filter sales
            const filteredSales = ERP_STATE.salesLog.filter(l => {
                if (start && new Date(l.date) < start) return false;
                if (end && new Date(l.date) > end) return false;
                if (REPORT_FILTERS.Party && l.party !== REPORT_FILTERS.Party) return false;
                if (REPORT_FILTERS.Broker && l.broker !== REPORT_FILTERS.Broker) return false;

                const cleanSize = (l.size || '').toString().replace(/ Sieve| size/gi, '').trim().toUpperCase();
                const cleanFilterSize = REPORT_FILTERS.Size ? REPORT_FILTERS.Size.toString().replace(/ Sieve| size/gi, '').trim().toUpperCase() : '';
                if (REPORT_FILTERS.Size && cleanSize !== cleanFilterSize) return false;

                if (REPORT_FILTERS.Purity && l.clarity !== REPORT_FILTERS.Purity) return false;
                return true;
            });

            saleBody.innerHTML = filteredSales.map(l => {
                const cleanSize = (l.size || '').toString().replace(/ Sieve| size/gi, '').trim();
                const costRate = getAveragePurchaseRate(cleanSize, l.clarity);
                const profit = Number(l.amount || 0) - (Number(l.carats || 0) * costRate);
                const marginPct = Number(l.amount || 0) > 0 ? (profit / Number(l.amount || 0)) * 100 : 0;

                return `
                    <tr>
                        <td><strong>${l.invoice || ''}</strong></td>
                        <td>${l.date || ''}</td>
                        <td>${l.party || ''}</td>
                        <td>${l.broker || ''}</td>
                        <td><span style="font-size:0.8rem; color:var(--text-muted);">${l.color || ''} | ${l.size || ''} | ${l.clarity || ''}</span></td>
                        <td style="text-align: right;">${Number(l.carats || 0).toFixed(3)} Cts</td>
                        <td style="text-align: right;">₹${Number(l.rate || 0).toLocaleString('en-IN')}</td>
                        <td style="text-align: right;">₹${Math.round(costRate).toLocaleString('en-IN')}</td>
                        <td style="text-align: right; font-weight:700; color:${profit >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}">₹${Math.round(profit).toLocaleString('en-IN')}</td>
                        <td style="text-align: right; font-weight:700; color:${profit >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}">${marginPct.toFixed(1)}%</td>
                    </tr>
                `;
            }).join('') || `<tr><td colspan="10" style="text-align:center; color:var(--text-muted);">No sales entries match active report filters.</td></tr>`;
        }

        function printReportLayout() {
            window.print();
        }

        function exportReportToExcel() {
            const tableId = activeReportTab === 'purchase' ? 'rep-purchase-table-data' : 'rep-sales-table-data';
            const table = document.getElementById(tableId);
            if (!table) return;

            let html = table.outerHTML;
            const url = 'data:application/vnd.ms-excel,' + encodeURIComponent(html);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${activeReportTab === 'purchase' ? 'purchase_report' : 'sales_margin_report'}.xls`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }

        function expandSelect(el) {
            if (!el || el.tagName !== 'SELECT') return;
            const w = el.offsetWidth;
            el.size = Math.min(el.options.length, 6);
            el.style.position = 'absolute';
            el.style.zIndex = '1000';
            el.style.background = 'white';
            el.style.boxShadow = '0 8px 20px rgba(0,0,0,0.1)';
            el.style.width = w + 'px';
        }

        function collapseSelect(el) {
            if (!el || el.tagName !== 'SELECT') return;
            el.size = 1;
            el.style.position = '';
            el.style.zIndex = '';
            el.style.background = '';
            el.style.boxShadow = '';
            el.style.width = '';
        }

        function focusAndExpand(id) {
            const el = document.getElementById(id);
            if (el) {
                el.focus();
                if (el.classList.contains('erp-custom-select')) {
                    const type = id.includes('party') ? 'party' : 'broker';
                    openSearchMenu(el, type);
                } else {
                    expandSelect(el);
                }
            }
        }

        // System Keyboard Navigation & Interactive listener
        document.addEventListener('keydown', (e) => {
            const searchMenu = document.getElementById('erp-custom-search-menu');
            const customDialog = document.getElementById('custom-dialog-overlay');
            const stockPicker = document.getElementById('stock-picker-modal');
            const assortStockPicker = document.getElementById('assort-stock-picker-modal');
            const quickMaster = document.getElementById('quick-master-modal');
            const passwordChallenge = document.getElementById('password-challenge-modal');
            const notepadPopup = document.getElementById('erp-notepad-popup');
            const calcPopup = document.getElementById('erp-calc-popup');

            const isSearchMenuOpen = searchMenu && searchMenu.style.display === 'flex';
            const isCustomDialogOpen = customDialog && customDialog.style.display !== 'none' && customDialog.style.display !== '';
            const isStockPickerOpen = stockPicker && stockPicker.style.display !== 'none' && stockPicker.style.display !== '';
            const isAssortStockPickerOpen = assortStockPicker && assortStockPicker.style.display !== 'none' && assortStockPicker.style.display !== '';
            const isQuickMasterOpen = quickMaster && quickMaster.style.display !== 'none' && quickMaster.style.display !== '';
            const isPasswordOpen = passwordChallenge && passwordChallenge.style.display !== 'none' && passwordChallenge.style.display !== '';
            const isNotepadOpen = notepadPopup && notepadPopup.style.display !== 'none' && notepadPopup.style.display !== '';
            const isCalcOpen = calcPopup && calcPopup.style.display !== 'none' && calcPopup.style.display !== '';

            // Handle keydown for custom dialog overlay (before login overlay check)
            if (isCustomDialogOpen) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeCustomDialog('cancel');
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    closeCustomDialog('ok');
                    return;
                }
            }

            // If login overlay is visible, let the input fields handle Enter themselves
            const loginOverlay = document.getElementById('admin-login-overlay');
            if (loginOverlay && loginOverlay.style.display !== 'none') return;

            // Handle keydown for sale stock picker modal
            if (isStockPickerOpen) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeStockPicker();
                    return;
                }
                const body = document.getElementById('stock-picker-body');
                if (body) {
                    const rows = body.querySelectorAll('tr');
                    const hasStock = rows.length > 0 && !rows[0].innerText.includes('No stock available');
                    if (hasStock) {
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            stockPickerSelectedIndex++;
                            if (stockPickerSelectedIndex >= rows.length) {
                                stockPickerSelectedIndex = 0;
                            }
                            updateStockPickerSelection();
                            return;
                        }
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            stockPickerSelectedIndex--;
                            if (stockPickerSelectedIndex < 0) {
                                stockPickerSelectedIndex = rows.length - 1;
                            }
                            updateStockPickerSelection();
                            return;
                        }
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            let idx = stockPickerSelectedIndex;
                            if (idx === -1) idx = 0;
                            const row = rows[idx];
                            if (row) {
                                const btn = row.querySelector('button');
                                if (btn) btn.click();
                            }
                            return;
                        }
                    }
                }
            }

            // Handle keydown for assort stock picker modal
            if (isAssortStockPickerOpen) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeAssortStockPicker();
                    return;
                }
                const body = document.getElementById('assort-stock-picker-body');
                if (body) {
                    const rows = body.querySelectorAll('tr');
                    const hasStock = rows.length > 0 && !rows[0].innerText.includes('No stock available');
                    if (hasStock) {
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            assortStockPickerSelectedIndex++;
                            if (assortStockPickerSelectedIndex >= rows.length) {
                                assortStockPickerSelectedIndex = 0;
                            }
                            updateAssortStockPickerSelection();
                            return;
                        }
                        if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            assortStockPickerSelectedIndex--;
                            if (assortStockPickerSelectedIndex < 0) {
                                assortStockPickerSelectedIndex = rows.length - 1;
                            }
                            updateAssortStockPickerSelection();
                            return;
                        }
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            let idx = assortStockPickerSelectedIndex;
                            if (idx === -1) idx = 0;
                            const row = rows[idx];
                            if (row) {
                                const btn = row.querySelector('button');
                                if (btn) btn.click();
                            }
                            return;
                        }
                    }
                }
            }

            // Handle keydown for quick master creation modal
            if (isQuickMasterOpen) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeQuickMasterModal();
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveQuickMasterItem();
                    return;
                }
            }

            // Handle keydown for password challenge verification modal
            if (isPasswordOpen) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelPasswordChallenge();
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submitPasswordChallenge();
                    return;
                }
            }

            // Handle keydown for custom searchable selection menu
            if (isSearchMenuOpen) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeSearchMenu();
                    if (activeSearchMenuTarget) activeSearchMenuTarget.focus();
                    return;
                }
            }

            // Handle default Escape key actions
            if (e.key === 'Escape') {
                if (isNotepadOpen) {
                    e.preventDefault();
                    notepadPopup.style.display = 'none';
                    return;
                }
                if (isCalcOpen) {
                    e.preventDefault();
                    calcPopup.style.display = 'none';
                    return;
                }
                if (adjOverlay) {
                    e.preventDefault();
                    closeAdjustmentDialog();
                    return;
                }

                const activeView = document.querySelector('.app-view.active-view');
                if (activeView && activeView.id !== 'view-blank') {
                    e.preventDefault();
                    switchView('view-blank');
                    return;
                }
            }

            // F-key sidebar view switching (F1-F11)
            const fKeyMap = {
                'F1': 'view-purchase',
                'F2': 'view-sale',
                'F3': 'view-stock',
                'F4': 'view-opening',
                'F5': 'view-assortment',
                'F6': 'view-mix',
                'F7': 'view-payment-entry',
                'F8': 'view-payment-ir',
                'F9': 'view-rojmel',
                'F10': 'view-reports',
                'F11': 'view-whatsapp'
            };
            if (fKeyMap[e.key]) {
                e.preventDefault();
                e.stopPropagation();
                switchView(fKeyMap[e.key]);
                return;
            }

            // Global custom keyboard shortcuts
            if (ERP_STATE.isLoggedIn && ERP_STATE.shortcuts) {
                for (const action in ERP_STATE.shortcuts) {
                    const s = ERP_STATE.shortcuts[action];
                    if (!s.key || s.active === false) continue;
                    
                    const keyMatch = e.key.toLowerCase() === s.key;
                    const altMatch = !!e.altKey === !!s.altKey;
                    const ctrlMatch = !!e.ctrlKey === !!s.ctrlKey;
                    const shiftMatch = !!e.shiftKey === !!s.shiftKey;
                    
                    if (keyMatch && altMatch && ctrlMatch && shiftMatch) {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        if (action.startsWith("Open ") && s.view) {
                            switchView(s.view);
                        } else {
                            const activeView = document.querySelector('.app-view.active-view');
                            if (activeView) {
                                if (activeView.id === 'view-purchase' || activeView.id === 'view-sale') {
                                    const type = activeView.id === 'view-purchase' ? 'pur' : 'sale';
                                    if (action === 'Add New') {
                                        actionAddNew(type);
                                    } else if (action === 'Save Invoice') {
                                        actionSaveInvoice(type);
                                    }
                                } else if (activeView.id === 'view-payment-entry') {
                                    if (action === 'Add New') {
                                        e.preventDefault();
                                        resetPaymentForm();
                                    } else if (action === 'Save Invoice') {
                                        e.preventDefault();
                                        savePaymentVoucher();
                                    }
                                }
                            }
                        }
                        return;
                    }
                }
            }

            const active = document.activeElement;
            if (!active) return;

            const id = active.id;
            const tag = active.tagName;

            // Prevent arrow keys from changing number input values
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
                (id === 'pur-sheet-carats' || id === 'pur-sheet-rate' ||
                 id === 'sale-sheet-carats' || id === 'sale-sheet-rate')) {
                e.preventDefault(); return;
            }

            if (e.key === 'Enter') {
                // Master Item Input direct save on Enter
                if (id === 'new-shade-name' || id === 'new-purity-name') { e.preventDefault(); addMasterItem('shade'); return; }
                if (id === 'new-number-name') { e.preventDefault(); addMasterItem('number'); return; }
                if (id === 'new-size-name') { e.preventDefault(); addMasterItem('size'); return; }
                if (id === 'new-party-name') { e.preventDefault(); addMasterItem('party'); return; }
                if (id === 'new-broker-name') { e.preventDefault(); addMasterItem('broker'); return; }
                if (id === 'quick-master-input') { e.preventDefault(); saveQuickMasterItem(); return; }

                // Param grid input navigation for Purchase/Sale forms
                if (id === 'pur-form-date') { e.preventDefault(); focusAndExpand('pur-form-inv-no'); return; }
                if (id === 'pur-form-inv-no') { e.preventDefault(); focusAndExpand('pur-form-party'); return; }
                if (id === 'sale-form-date') { e.preventDefault(); focusAndExpand('sale-form-inv-no'); return; }
                if (id === 'sale-form-inv-no') { e.preventDefault(); focusAndExpand('sale-form-party'); return; }

                // Payment entry navigation and save on Enter
                if (id === 'payment-voucher-date') { e.preventDefault(); focusAndExpand('payment-type'); return; }
                if (id === 'payment-type') {
                    e.preventDefault();
                    if (active.size && active.size > 1) {
                        active.dispatchEvent(new Event('change'));
                        collapseSelect(active);
                        focusAndExpand('payment-party');
                    } else {
                        expandSelect(active);
                    }
                    return;
                }
                if (id === 'payment-party') {
                    e.preventDefault();
                    openSearchMenu(active, 'party');
                    return;
                }
                if (id === 'payment-amount') { e.preventDefault(); focusAndExpand('payment-mode'); return; }
                if (id === 'payment-mode') {
                    e.preventDefault();
                    if (active.size && active.size > 1) {
                        active.dispatchEvent(new Event('change'));
                        collapseSelect(active);
                        const remarks = document.getElementById('payment-remarks');
                        if (remarks) remarks.focus();
                    } else {
                        expandSelect(active);
                    }
                    return;
                }
                if (id === 'payment-remarks') {
                    e.preventDefault();
                    savePaymentVoucher();
                    return;
                }

                // Sale broker: after selecting a valid value, open stock picker
                if (id === 'sale-form-broker') {
                    e.preventDefault();
                    if (active.size && active.size > 1) {
                        active.dispatchEvent(new Event('change'));
                        collapseSelect(active);
                        const val = active.value;
                        if (val && val !== '+ Add New Party' && val !== '+ Add New Broker') {
                            openStockPicker();
                        }
                    } else {
                        expandSelect(active);
                    }
                    return;
                }

                // Sale shade: click or Enter opens stock picker
                if (id === 'sale-sheet-shade') {
                    e.preventDefault(); openStockPicker(); return;
                }

                // Sheet rate: go to discount
                if (id === 'pur-sheet-rate') {
                    e.preventDefault();
                    const disc = document.getElementById('pur-sheet-disc');
                    if (disc) disc.focus();
                    return;
                }
                // Sheet discount: go to note/remark
                if (id === 'pur-sheet-disc') {
                    e.preventDefault();
                    const note = document.getElementById('pur-sheet-remark');
                    if (note) note.focus();
                    return;
                }
                // Remark: add row with all data including note, then go to shade
                if (id === 'pur-sheet-remark') {
                    e.preventDefault(); addSheetRow('pur'); return;
                }
                if (id === 'sale-sheet-rate') {
                    e.preventDefault();
                    const disc = document.getElementById('sale-sheet-disc');
                    if (disc) disc.focus();
                    return;
                }
                if (id === 'sale-sheet-disc') {
                    e.preventDefault();
                    const note = document.getElementById('sale-sheet-remark');
                    if (note) note.focus();
                    return;
                }
                if (id === 'sale-sheet-remark') {
                    e.preventDefault(); addSheetRow('sale'); return;
                }

                // For all other inputs/buttons, move to next field
                if (tag === 'INPUT' || tag === 'BUTTON') {
                    e.preventDefault();
                    focusNextElement();
                    return;
                }

                // For all SELECT elements: first Enter expands, second Enter selects+advances
                if (tag === 'SELECT') {
                    e.preventDefault();
                    if (active.size && active.size > 1) {
                        active.dispatchEvent(new Event('change'));
                        collapseSelect(active);
                        focusNextElement();
                    } else {
                        expandSelect(active);
                    }
                }
            }
        });

        // Collapse expanded selects when they lose focus
        document.addEventListener('focusout', (e) => {
            const t = e.target;
            if (t && t.tagName === 'SELECT' && t.size > 1) collapseSelect(t);
        });

        function focusNextElement() {
            const activeView = document.querySelector('.app-view.active-view');
            if (!activeView) return;

            const focusables = Array.from(activeView.querySelectorAll('input:not([readonly]):not([disabled]), input.erp-custom-select:not([disabled]), select:not([disabled]), button:not([disabled])'))
                                    .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);

            const index = focusables.indexOf(document.activeElement);
            if (index !== -1 && index < focusables.length - 1) {
                focusables[index + 1].focus();
            }
        }

        function renderRojmelTable() {
            const incomeBody = document.getElementById('rojmel-income-body');
            const expenseBody = document.getElementById('rojmel-expense-body');
            if (!incomeBody || !expenseBody) return;

            // Default date filter to today if empty
            const dateInput = document.getElementById('rojmel-date-filter');
            if (!dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
            const filterDate = dateInput.value;
            const searchFilter = document.getElementById('rojmel-search-filter').value.toLowerCase();

            // Calculate opening balance: sum of all income before filterDate minus all expense before filterDate
            let openingBalance = 0;

            // Helper: add income/expense amounts up to (but not including) filterDate
            // Note: purchases and sales are excluded — only actual cash transactions affect rojmel balance
            function accumulateBeforeDate(dateStr) {
                let bal = 0;
                // Payments: RECEIPT = income, PAYMENT = expense (Skip SET-OFF non-cash adjustments)
                (ERP_STATE.payments || []).forEach(p => {
                    if (p.date < dateStr && p.mode !== 'SET-OFF') {
                        bal += (p.type === 'RECEIPT' ? 1 : -1) * (p.amount || 0);
                    }
                });
                // Adjustment entries
                (ERP_STATE.adjEntries || []).forEach(a => {
                    if (a.date < dateStr) {
                        bal += (a.type === 'INCOME' ? 1 : -1) * (a.amount || 0);
                    }
                });
                return bal;
            }

            openingBalance = accumulateBeforeDate(filterDate);

            // Collect today's entries
            const incomeEntries = [];
            const expenseEntries = [];

            function pushEntry(list, date, ref, amount, sortKey) {
                if (searchFilter && !ref.toLowerCase().includes(searchFilter)) return;
                list.push({ date, ref, amount, sortKey: sortKey || date });
            }

            // Payments: RECEIPT → Income, PAYMENT → Expense (Skip SET-OFF non-cash adjustments)
            (ERP_STATE.payments || []).forEach(p => {
                if (p.date === filterDate && p.mode !== 'SET-OFF') {
                    const ref = `${p.type} Voucher [${p.voucherId}] - ${p.party} - ${p.mode} ${p.remarks ? '- ' + p.remarks : ''}`;
                    if (p.type === 'RECEIPT') {
                        pushEntry(incomeEntries, p.date, ref, p.amount || 0);
                    } else {
                        pushEntry(expenseEntries, p.date, ref, p.amount || 0);
                    }
                }
            });

            // Adjustment entries: INCOME → Income, EXPENSE → Expense
            (ERP_STATE.adjEntries || []).forEach(a => {
                if (a.date === filterDate) {
                    const ref = `ADJ [${a.voucherId}] - ${a.description}`;
                    if (a.type === 'INCOME') {
                        pushEntry(incomeEntries, a.date, ref, a.amount || 0);
                    } else {
                        pushEntry(expenseEntries, a.date, ref, a.amount || 0);
                    }
                }
            });

            // Sort each list chronologically by date (with time if available)
            incomeEntries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
            expenseEntries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

            // Calculate totals
            const incomeTotal = incomeEntries.reduce((s, e) => s + e.amount, 0);
            const expenseTotal = expenseEntries.reduce((s, e) => s + e.amount, 0);
            const closingBalance = openingBalance + incomeTotal - expenseTotal;

            // Render income table
            if (incomeEntries.length === 0) {
                incomeBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.85rem;">No income entries for this date.</td></tr>';
            } else {
                incomeBody.innerHTML = incomeEntries.map((e, i) => `
                    <tr>
                        <td style="text-align:center;">${i + 1}</td>
                        <td>${e.date}</td>
                        <td style="font-size:0.78rem;">${e.ref}</td>
                        <td style="text-align:right; font-weight:bold; color:#2e7d32;">₹${e.amount.toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
                    </tr>
                `).join('');
            }

            // Render expense table
            if (expenseEntries.length === 0) {
                expenseBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.85rem;">No expense entries for this date.</td></tr>';
            } else {
                expenseBody.innerHTML = expenseEntries.map((e, i) => `
                    <tr>
                        <td style="text-align:center;">${i + 1}</td>
                        <td>${e.date}</td>
                        <td style="font-size:0.78rem;">${e.ref}</td>
                        <td style="text-align:right; font-weight:bold; color:#c62828;">₹${e.amount.toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
                    </tr>
                `).join('');
            }

            // Update summary cards
            document.getElementById('rojmel-opening-bal').innerHTML = `₹${openingBalance.toLocaleString('en-IN', {minimumFractionDigits:2})}`;
            document.getElementById('rojmel-income-total').innerHTML = `₹${incomeTotal.toLocaleString('en-IN', {minimumFractionDigits:2})}`;
            document.getElementById('rojmel-expense-total').innerHTML = `₹${expenseTotal.toLocaleString('en-IN', {minimumFractionDigits:2})}`;
            document.getElementById('rojmel-closing-bal').innerHTML = `₹${closingBalance.toLocaleString('en-IN', {minimumFractionDigits:2})}`;
        }

        // ── Adjustment Voucher Dialog ──────────────────────────────────────
        let adjOverlay = null;

        function closeAdjustmentDialog() {
            if (adjOverlay) {
                adjOverlay.remove();
                adjOverlay = null;
            }
        }

        function showAdjustmentDialog() {
            closeAdjustmentDialog(); // remove any existing
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.4); z-index:10000; display:flex; align-items:center; justify-content:center;';
            overlay.innerHTML = `
                <div style="background:white; border-radius:8px; padding:20px; width:400px; max-width:90vw; box-shadow:0 8px 30px rgba(0,0,0,0.3); pointer-events:auto;">
                    <div style="font-weight:bold; font-size:1rem; margin-bottom:12px; color:#002878;">Manual Adjustment Voucher</div>
                    <div class="erp-param-group" style="margin-bottom:8px;">
                        <label>Date</label>
                        <input type="date" id="adj-date" value="${new Date().toISOString().split('T')[0]}" style="width:100%; padding:4px 6px; font-size:0.8rem; border:1px solid #b0b0a8; border-radius:3px;">
                    </div>
                    <div class="erp-param-group" style="margin-bottom:8px;">
                        <label>Type</label>
                        <select id="adj-type" style="width:100%; padding:4px 6px; font-size:0.8rem; border:1px solid #b0b0a8; border-radius:3px;">
                            <option value="INCOME">Income (Cash In)</option>
                            <option value="EXPENSE">Expense (Cash Out)</option>
                        </select>
                    </div>
                    <div class="erp-param-group" style="margin-bottom:8px;">
                        <label>Description</label>
                        <input type="text" id="adj-desc" placeholder="e.g. Tea, Stationery, Rent, Deposit..." style="width:100%; padding:4px 6px; font-size:0.8rem; border:1px solid #b0b0a8; border-radius:3px;">
                    </div>
                    <div class="erp-param-group" style="margin-bottom:12px;">
                        <label>Amount (₹)</label>
                        <input type="number" id="adj-amount" step="0.01" min="0" placeholder="0.00" style="width:100%; padding:4px 6px; font-size:0.8rem; border:1px solid #b0b0a8; border-radius:3px;">
                    </div>
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button onclick="closeAdjustmentDialog()" style="padding:6px 16px; background:#ddd; border:none; border-radius:4px; cursor:pointer; font-size:0.8rem;">Cancel</button>
                        <button onclick="saveAdjustmentVoucher()" style="padding:6px 16px; background:#002878; color:white; border:none; border-radius:4px; cursor:pointer; font-size:0.8rem; font-weight:600;">Save</button>
                    </div>
                </div>
            `;
            // Close on backdrop click
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) closeAdjustmentDialog();
            });
            // Close on Escape (stopPropagation prevents global Escape handler from firing)
            overlay.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    closeAdjustmentDialog();
                }
            });
            // Focus trap so Escape works immediately
            overlay.setAttribute('tabindex', '-1');
            document.body.appendChild(overlay);
            overlay.focus();
            adjOverlay = overlay;
        }

        function saveAdjustmentVoucher() {
            const date = document.getElementById('adj-date').value;
            const type = document.getElementById('adj-type').value;
            const description = document.getElementById('adj-desc').value.trim();
            const amount = parseFloat(document.getElementById('adj-amount').value) || 0;

            if (!date || !description || amount <= 0) {
                showCustomAlert("Validation Error", "Please fill Date, Description, and valid Amount.", "warning");
                return;
            }

            const voucherId = `ADJ-${Date.now().toString().slice(-8)}`;

            // Save to adjEntries
            if (!ERP_STATE.adjEntries) ERP_STATE.adjEntries = [];
            ERP_STATE.adjEntries.push({ date, type, description, amount, voucherId, timestamp: Date.now() });

            // Push to rojmel log
            const deltaStr = type === 'INCOME' ? `+₹${amount.toFixed(2)}` : `-₹${amount.toFixed(2)}`;
            ERP_STATE.rojmel.unshift({
                time: `${date} Adjustment`,
                type: type,
                msg: `Adjustment Voucher [${voucherId}] - ${description}`,
                delta: deltaStr,
                timestamp: Date.now()
            });

            // Audit trail
            if (!ERP_STATE.auditTrail) ERP_STATE.auditTrail = [];
            const auditType = type === 'INCOME' ? 'INCOME' : 'EXPENSE';
            ERP_STATE.auditTrail.push({
                id: 'AUD-' + Date.now(),
                timestamp: new Date().toLocaleString(),
                type: auditType,
                refNo: voucherId,
                party: description,
                carats: 0,
                amount: amount,
                status: 'ACTIVE'
            });

            saveDatabaseState();
            renderRojmelTable();

            // Close the dialog
            closeAdjustmentDialog();

            showCustomAlert("Success", `Adjustment Voucher ${voucherId} saved.`, "success");
        }

        // ── Audit Trail (Transaction Log) ──────────────────────────────────
        const AUDIT_ACTIVE_TAB = 'PURCHASE';

        function switchAuditTab(tab) {
            ['PURCHASE','SALE','INCOME','EXPENSE'].forEach(t => {
                const el = document.getElementById('btn-audit-' + t.toLowerCase());
                if (el) el.classList.toggle('active', t === tab);
            });
            renderReportsAuditLogTable(tab);
        }

        function renderReportsAuditLogTable(tab) {
            tab = tab || AUDIT_ACTIVE_TAB;
            const body = document.getElementById('audit-log-body');
            if (!body) return;

            let entries = (ERP_STATE.auditTrail || []).filter(x => x.type === tab);
            entries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

            if (entries.length === 0) {
                body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:25px; color:var(--text-muted); font-size:0.9rem;">No audit records found for this category.</td></tr>';
                return;
            }

            body.innerHTML = entries.map(e => {
                const isDeleted = e.status === 'DELETED';
                const statusHtml = isDeleted
                    ? '<span style="color:#c62828; font-weight:bold; background:#ffebee; padding:2px 8px; border-radius:4px;">⚠️ ENTRY DELETED</span>'
                    : '<span style="color:#2e7d32; font-weight:600; background:#e8f5e9; padding:2px 8px; border-radius:4px;">ACTIVE</span>';
                const rowStyle = isDeleted ? ' style="background:#ffebee;"' : '';
                return `<tr${rowStyle}>
                    <td style="font-size:0.78rem;">${e.timestamp || '-'}</td>
                    <td><strong>${e.refNo || '-'}</strong></td>
                    <td style="font-size:0.8rem;">${e.party || '-'}</td>
                    <td style="text-align:right;">${e.carats ? e.carats.toFixed(3) : '0.000'}</td>
                    <td style="text-align:right; font-weight:600;">₹${(e.amount || 0).toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
                    <td style="text-align:center;">${statusHtml}</td>
                </tr>`;
            }).join('');
        }

        // ── Payment Party Balance ──────────────────────────────────────────
        function calculatePartyNetBalance(partyName) {
            if (!partyName) return { amount: 0, type: 'NONE', text: 'Select a party to view pending balance' };
            const normParty = partyName.trim().toUpperCase();

            const salesAmt = (ERP_STATE.salesLog || [])
                .filter(s => (s.party || "").trim().toUpperCase() === normParty)
                .reduce((sum, s) => sum + (s.amount || 0), 0);

            const receiptsAmt = (ERP_STATE.payments || [])
                .filter(p => p.type === 'RECEIPT' && (p.party || "").trim().toUpperCase() === normParty)
                .reduce((sum, p) => sum + (p.amount || 0), 0);

            const purchasesAmt = (ERP_STATE.purchaseLog || [])
                .filter(p => (p.party || "").trim().toUpperCase() === normParty)
                .reduce((sum, p) => sum + (p.amount || 0), 0);

            const paidAmt = (ERP_STATE.payments || [])
                .filter(p => p.type === 'PAYMENT' && (p.party || "").trim().toUpperCase() === normParty)
                .reduce((sum, p) => sum + (p.amount || 0), 0);

            const netReceivable = salesAmt - receiptsAmt;
            const netPayable = purchasesAmt - paidAmt;
            const balance = netReceivable - netPayable;

            if (balance > 0.01) {
                return { amount: balance, type: 'RECEIVABLE', text: 'Receivable (લેવાના)' };
            } else if (balance < -0.01) {
                return { amount: Math.abs(balance), type: 'PAYABLE', text: 'Payable (દેવાના)' };
            }
            return { amount: 0, type: 'SETTLED', text: 'Settled (સરભર)' };
        }

        function updatePaymentPartyBalanceDisplay() {
            const el = document.getElementById('payment-party-balance-info');
            if (!el) return;
            const party = document.getElementById('payment-party').value;
            const result = calculatePartyNetBalance(party);
            const fmt = (v) => '₹' + v.toLocaleString('en-IN', {minimumFractionDigits: 2});
            if (result.type === 'RECEIVABLE') {
                el.innerHTML = `<span style="color:#2e7d32;">🟢 Pending: ${fmt(result.amount)} ${result.text}</span>`;
            } else if (result.type === 'PAYABLE') {
                el.innerHTML = `<span style="color:#c62828;">🔴 Pending: ${fmt(result.amount)} ${result.text}</span>`;
            } else if (result.type === 'SETTLED') {
                el.innerHTML = `<span style="color:#666;">⚪ Balance ${result.text}</span>`;
            } else {
                el.innerHTML = `<span style="color:#999;">${result.text}</span>`;
            }
        }

        function renderPaymentVoucherTable() {
            const body = document.getElementById('payment-voucher-table-body');
            if (!body) return;
            const payments = ERP_STATE.payments || [];
            if (payments.length === 0) {
                body.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-muted);">No vouchers recorded yet.</td></tr>';
                return;
            }
            body.innerHTML = payments.map((v, idx) => `
                <tr>
                    <td>${v.date}</td>
                    <td><strong>${v.voucherId}</strong></td>
                    <td>${v.type}</td>
                    <td>${v.party}</td>
                    <td style="text-align:right; font-weight:bold;">₹${v.amount.toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
                    <td>${v.mode}</td>
                    <td style="font-size:0.75rem; color:var(--text-muted);">${v.remarks || ''}</td>
                    <td style="text-align:center;"><span style="color:var(--danger-color); font-weight:bold; cursor:pointer; font-size:1.1rem;" onclick="deletePaymentVoucher(${idx})">✖</span></td>
                </tr>
            `).join('');
        }

        function savePaymentVoucher() {
            const date = document.getElementById('payment-voucher-date').value;
            const type = document.getElementById('payment-type').value;
            const party = document.getElementById('payment-party').value.trim().toUpperCase();
            const amount = parseFloat(document.getElementById('payment-amount').value) || 0;
            const mode = document.getElementById('payment-mode').value;
            const remarks = document.getElementById('payment-remarks').value.trim();

            if (!date || !party || amount <= 0) {
                showCustomAlert("Validation Error", "Please fill Date, Party, and valid Amount.", "warning");
                return;
            }

            const voucherId = `PAY-${Date.now().toString().slice(-8)}-${(ERP_STATE.payments.length + 1).toString().padStart(3, '0')}`;

            const voucher = { date, type, party, amount, mode, remarks, voucherId, timestamp: Date.now() };
            ERP_STATE.payments.push(voucher);

            // Push to rojmel log
            const deltaStr = type === 'RECEIPT' ? `+₹${amount.toFixed(2)}` : `-₹${amount.toFixed(2)}`;
            ERP_STATE.rojmel.unshift({
                time: date + " Payment",
                type: type,
                msg: `${type} Voucher [${voucherId}] - ${party} - ${mode} - ${remarks || 'N/A'}`,
                delta: deltaStr,
                timestamp: Date.now()
            });

            // Audit trail
            if (!ERP_STATE.auditTrail) ERP_STATE.auditTrail = [];
            const auditType = type === 'RECEIPT' ? 'INCOME' : 'EXPENSE';
            ERP_STATE.auditTrail.push({
                id: 'AUD-' + Date.now(),
                timestamp: new Date().toLocaleString(),
                type: auditType,
                refNo: voucherId,
                party: party,
                carats: 0,
                amount: amount,
                status: 'ACTIVE'
            });

            saveDatabaseState();
            renderPaymentVoucherTable();
            renderPaymentIRTable();
            updatePaymentPartyBalanceDisplay();
            resetPaymentForm();
            showCustomAlert("Success", `Voucher ${voucherId} saved successfully!`, "success");
        }

        function resetPaymentForm() {
            document.getElementById('payment-voucher-date').value = new Date().toISOString().split('T')[0];
            document.getElementById('payment-type').value = 'RECEIPT';
            document.getElementById('payment-party').value = '';
            document.getElementById('payment-amount').value = '';
            document.getElementById('payment-mode').value = 'Cash';
            document.getElementById('payment-remarks').value = '';
            document.getElementById('payment-voucher-date').focus();
            updatePaymentPartyBalanceDisplay();
        }

        function deletePaymentVoucher(idx) {
            challengeAdminPassword(() => {
                showCustomConfirm('Delete Voucher', `Are you sure you want to delete ${ERP_STATE.payments[idx].voucherId}?`, () => {
                    const removed = ERP_STATE.payments.splice(idx, 1)[0];
                    // Remove corresponding rojmel entry
                    ERP_STATE.rojmel = ERP_STATE.rojmel.filter(r => !r.msg.includes(removed.voucherId));
                    // Audit trail deletion marker
                    const auditType = removed.type === 'RECEIPT' ? 'INCOME' : 'EXPENSE';
                    const auditItem = (ERP_STATE.auditTrail || []).find(x => x.type === auditType && x.refNo === removed.voucherId);
                    if (auditItem) {
                        auditItem.status = 'DELETED';
                        auditItem.deletedAt = new Date().toLocaleString();
                    }
                    saveDatabaseState();
                    renderPaymentVoucherTable();
                    renderPaymentIRTable();
                    updatePaymentPartyBalanceDisplay();
                    showCustomAlert("Deleted", `Voucher ${removed.voucherId} deleted.`, "info");
                });
            }, "Enter password to delete payment voucher:");
        }

        function renderPaymentIRTable() {
            const body = document.getElementById('payment-ir-table');
            if (!body) return;

            // Collect all invoices grouped by party
            const invoices = [];
            const now = new Date();

            // Purchase invoices (outward - we owe money)
            ERP_STATE.purchaseLog.forEach(item => {
                if (!item.party) return;
                const invDate = new Date(item.date);
                const meta = ERP_STATE.invoiceMetadata[item.invoice] || {};
                const creditDays = parseInt(meta.days) || 30;
                const targetDate = new Date(invDate);
                targetDate.setDate(targetDate.getDate() + creditDays);
                const daysDelta = Math.floor((now - targetDate) / (1000 * 60 * 60 * 24));
                invoices.push({
                    type: 'OUTWARD (Purchase)',
                    party: item.party,
                    invNo: item.invoice,
                    date: item.date,
                    targetDate: targetDate,
                    daysDelta: daysDelta,
                    carats: item.carats || 0,
                    amount: item.amount || 0,
                    isOutward: true
                });
            });

            // Sales invoices (inward - customer owes us)
            ERP_STATE.salesLog.forEach(item => {
                if (!item.party) return;
                const invDate = new Date(item.date);
                const meta = ERP_STATE.invoiceMetadata[item.invoice] || {};
                const creditDays = parseInt(meta.days) || 15;
                const targetDate = new Date(invDate);
                targetDate.setDate(targetDate.getDate() + creditDays);
                const daysDelta = Math.floor((now - targetDate) / (1000 * 60 * 60 * 24));
                invoices.push({
                    type: 'INWARD (Sale)',
                    party: item.party,
                    invNo: item.invoice,
                    date: item.date,
                    targetDate: targetDate,
                    daysDelta: daysDelta,
                    carats: item.carats || 0,
                    amount: item.amount || 0,
                    isOutward: false
                });
            });

            // Group invoices by party for FIFO allocation
            const partyGroups = {};
            invoices.forEach(inv => {
                if (!partyGroups[inv.party]) partyGroups[inv.party] = [];
                partyGroups[inv.party].push(inv);
            });

            // Sort each party's invoices by date (oldest first for FIFO)
            Object.values(partyGroups).forEach(group => {
                group.sort((a, b) => new Date(a.date) - new Date(b.date));
            });

            // Calculate total payments per party
            const paymentsByParty = {};
            (ERP_STATE.payments || []).forEach(p => {
                const key = p.party.toUpperCase();
                const amt = p.amount || 0;
                if (p.type === 'RECEIPT') {
                    paymentsByParty[key] = (paymentsByParty[key] || 0) + amt; // reduces inward outstanding
                } else {
                    paymentsByParty[key] = (paymentsByParty[key] || 0) - amt; // reduces outward outstanding
                }
            });

            // Apply FIFO allocation: for each party, apply net payment to oldest invoices
            const outstandingRows = [];
            Object.entries(partyGroups).forEach(([party, group]) => {
                let netPayment = paymentsByParty[party] || 0;

                group.forEach(inv => {
                    let outstanding = inv.amount;
                    if (inv.isOutward && netPayment < 0) {
                        // Payment (outward) reduces outward invoices
                        const alloc = Math.min(Math.abs(netPayment), outstanding);
                        outstanding -= alloc;
                        netPayment += alloc;
                    } else if (!inv.isOutward && netPayment > 0) {
                        // Receipt (inward) reduces inward invoices
                        const alloc = Math.min(netPayment, outstanding);
                        outstanding -= alloc;
                        netPayment -= alloc;
                    }

                    if (outstanding > 0.01) {
                        const daysDelta = inv.daysDelta;
                        const agingStatus = daysDelta > 0
                            ? `<span style="color:#e74c3c; font-weight:bold;">Overdue by ${daysDelta} days</span>`
                            : `<span style="color:#666;">Due in ${Math.abs(daysDelta)} days</span>`;
                        outstandingRows.push({
                            type: inv.type,
                            party: inv.party,
                            invNo: inv.invNo,
                            carats: inv.carats,
                            amount: outstanding,
                            targetDate: inv.targetDate,
                            daysDelta: daysDelta,
                            agingStatus: agingStatus
                        });
                    }
                });
            });

            if (outstandingRows.length === 0) {
                body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted); font-size:0.9rem; font-weight:600;">No outstanding records found.</td></tr>';
                return;
            }

            body.innerHTML = outstandingRows.map(r => `
                <tr>
                    <td style="text-align:center;">${r.type}</td>
                    <td>${r.party} [${r.invNo}]</td>
                    <td style="text-align:right;">${r.carats.toFixed(3)}</td>
                    <td style="text-align:right; font-weight:bold;">₹${r.amount.toLocaleString('en-IN', {minimumFractionDigits:2})}</td>
                    <td style="text-align:center;">${r.targetDate.toLocaleDateString('en-IN')}</td>
                    <td style="text-align:center;">${r.daysDelta > 0 ? '+' : ''}${r.daysDelta}</td>
                    <td style="text-align:center;">${r.agingStatus}</td>
                </tr>
            `).join('');
        }

        function renderMasterLists() {
            if (document.getElementById('master-shade-list')) {
                document.getElementById('master-shade-list').innerHTML = ERP_STATE.masters.colors.map(i => `<li>• ${i}</li>`).join('');
            }
            if (document.getElementById('master-purity-list')) {
                document.getElementById('master-purity-list').innerHTML = ERP_STATE.masters.purities.map(i => `<li>• ${i}</li>`).join('');
            }
            document.getElementById('master-number-list').innerHTML = ERP_STATE.masters.numbers.map(i => `<li>• ${i}</li>`).join('');
            document.getElementById('master-size-list').innerHTML = ERP_STATE.masters.sizes.map(i => `<li>• ${i}</li>`).join('');
            document.getElementById('master-party-list').innerHTML = ERP_STATE.masters.parties.map(i => `<li>• ${i}</li>`).join('');
            document.getElementById('master-broker-list').innerHTML = ERP_STATE.masters.brokers.map(i => `<li>• ${i}</li>`).join('');
            // Populate delete dropdowns
            ['shade','purity','number','size','party','broker'].forEach(type => {
                const sel = document.getElementById(`delete-${type}`);
                if (!sel) return;
                const arr = ERP_STATE.masters[
                    type === 'shade' ? 'colors' :
                    type === 'purity' ? 'purities' : 
                    type === 'number' ? 'numbers' : 
                    type === 'party' ? 'parties' : 
                    type + 's'
                ];
                if (sel.tagName === 'SELECT') {
                    sel.innerHTML = arr.map(i => `<option value="${i.replace(/"/g,'&quot;')}">${i}</option>`).join('');
                } else if (sel.tagName === 'INPUT') {
                    if (sel.value && !arr.includes(sel.value)) {
                        sel.value = "";
                        sel.dispatchEvent(new Event('change'));
                    }
                }
            });
        }

        // Custom Master Dependency Injector Interface Placeholder
        function updateColorMasterDependency() {
            console.log("Color master changes tracked. Dropdown context adjusted.");
        }

        // ── Sale Stock Picker ────────────────────────────────────
        let stockPickerSelectedIndex = -1;

        function updateStockPickerSelection() {
            const body = document.getElementById('stock-picker-body');
            if (!body) return;
            const rows = body.querySelectorAll('tr');
            rows.forEach((row, idx) => {
                if (idx === stockPickerSelectedIndex) {
                    row.style.background = '#eef2fa';
                    row.style.fontWeight = 'bold';
                    row.scrollIntoView({ block: 'nearest' });
                } else {
                    row.style.background = '';
                    row.style.fontWeight = '';
                }
            });
        }

        function openStockPicker() {
            stockPickerSelectedIndex = -1;
            const body = document.getElementById('stock-picker-body');
            if (!body) return;

            // Retrieve invoice number being edited
            const invNo = document.getElementById('sale-form-inv-no').value.trim();
            const originalItems = invNo ? ERP_STATE.salesLog.filter(x => x.invoice === invNo) : [];

            // Combine stock with original items of this invoice to display total available for edit
            const tempStock = { ...ERP_STATE.stock };
            originalItems.forEach(oldItem => {
                const stockKey = `${oldItem.color}||${oldItem.size}||${oldItem.clarity}`;
                tempStock[stockKey] = (tempStock[stockKey] || 0) + oldItem.carats;
            });

            let html = '';
            let hasStock = false;

            for (const [key, carats] of Object.entries(tempStock)) {
                if (carats <= 0) continue;
                hasStock = true;
                const [color, size, purity] = key.split('||');
                const avgRate = getAveragePurchaseRate(size, purity);
                const amount = carats * avgRate;
                html += `
                    <tr>
                        <td>${color}</td>
                        <td>${size}</td>
                        <td><span style="background:rgba(0,0,0,0.04); padding:2px 6px; border-radius:4px; font-weight:600;">${purity}</span></td>
                        <td style="text-align:right; font-weight:bold;">${carats.toFixed(3)}</td>
                        <td style="text-align:right;">₹${avgRate.toLocaleString('en-IN')}</td>
                        <td style="text-align:right; font-weight:bold;">₹${amount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                        <td style="text-align:center;"><button type="button" class="erp-btn" onclick="pickStock('${key}', ${carats})" style="padding:1px 6px; font-weight:bold; font-size:0.8rem;">Sel</button></td>
                    </tr>
                `;
            }

            body.innerHTML = hasStock ? html : '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">No stock available for sale.</td></tr>';

            document.getElementById('stock-picker-overlay').style.display = 'block';
            document.getElementById('stock-picker-modal').style.display = 'block';
        }

        function pickStock(key, adjustedAvail) {
            const parts = key.split('||');
            const color = parts[0];
            const size = parts[1];
            const purity = parts[2];
            const avail = adjustedAvail !== undefined ? adjustedAvail : (ERP_STATE.stock[key] || 0);
            if (avail <= 0) return;

            document.getElementById('sale-sheet-shade').value = color;
            document.getElementById('sale-sheet-size').value = size;
            document.getElementById('sale-sheet-number').value = purity;
            const availEl = document.getElementById('sale-sheet-avail');
            if (availEl) availEl.value = avail.toFixed(3);
            document.getElementById('sale-sheet-carats').value = '';
            document.getElementById('sale-sheet-rate').value = '';
            document.getElementById('sale-sheet-amount').value = '';
            document.getElementById('sale-sheet-remark').value = '';
            closeStockPicker();
            const caratsField = document.getElementById('sale-sheet-carats');
            if (caratsField) caratsField.focus();
        }

        function closeStockPicker() {
            document.getElementById('stock-picker-overlay').style.display = 'none';
            document.getElementById('stock-picker-modal').style.display = 'none';
        }

        // Assortment Stock Picker Functions
        let assortStockPickerSelectedIndex = -1;

        function updateAssortStockPickerSelection() {
            const body = document.getElementById('assort-stock-picker-body');
            if (!body) return;
            const rows = body.querySelectorAll('tr');
            rows.forEach((row, idx) => {
                if (idx === assortStockPickerSelectedIndex) {
                    row.style.background = '#eef2fa';
                    row.style.fontWeight = 'bold';
                    row.scrollIntoView({ block: 'nearest' });
                } else {
                    row.style.background = '';
                    row.style.fontWeight = '';
                }
            });
        }

        function openAssortStockPicker() {
            assortStockPickerSelectedIndex = -1;
            const body = document.getElementById('assort-stock-picker-body');
            if (!body) return;

            let html = '';
            let hasStock = false;

            for (const [key, carats] of Object.entries(ERP_STATE.stock)) {
                if (carats <= 0) continue;
                hasStock = true;
                const [color, size, purity] = key.split('||');
                html += `
                    <tr>
                        <td>${color}</td>
                        <td>${size}</td>
                        <td><span style="background:rgba(0,0,0,0.04); padding:2px 6px; border-radius:4px; font-weight:600;">${purity}</span></td>
                        <td style="text-align:right; font-weight:bold;">${carats.toFixed(3)}</td>
                        <td style="text-align:center;"><button type="button" class="erp-btn" onclick="pickStockForAssort('${key}', ${carats})" style="padding:1px 6px; font-weight:bold; font-size:0.8rem;">Sel</button></td>
                    </tr>
                `;
            }

            body.innerHTML = hasStock ? html : '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-muted);">No stock available.</td></tr>';

            // Reset manual picker inputs
            const manualSizeSelect = document.getElementById('assort-picker-manual-size');
            if (manualSizeSelect) {
                if (ERP_STATE.masters.sizes.length > 0) {
                    manualSizeSelect.value = ERP_STATE.masters.sizes[0];
                }
            }
            const manualCaratsInput = document.getElementById('assort-picker-manual-carats');
            if (manualCaratsInput) manualCaratsInput.value = '';

            document.getElementById('assort-stock-picker-overlay').style.display = 'block';
            document.getElementById('assort-stock-picker-modal').style.display = 'block';
        }

        function closeAssortStockPicker() {
            document.getElementById('assort-stock-picker-overlay').style.display = 'none';
            document.getElementById('assort-stock-picker-modal').style.display = 'none';
        }

        function pickStockForAssort(key, carats) {
            const parts = key.split('||');
            const color = parts[0];
            const size = parts[1];
            const purity = parts[2];

            // Set carats
            const caratsField = document.getElementById('assort-caratsGiven');
            if (caratsField) caratsField.value = carats.toFixed(3);

            // Clean size to match sieve size selection
            const cleanSize = (size || "").replace(/ Sieve| size/gi, '').trim().toUpperCase();
            
            // Try to match in assort-sieveSize options
            const sieveSelect = document.getElementById('assort-sieveSize');
            if (sieveSelect) {
                let matched = false;
                for (let i = 0; i < sieveSelect.options.length; i++) {
                    const optVal = sieveSelect.options[i].value.trim().toUpperCase();
                    if (optVal === cleanSize) {
                        sieveSelect.selectedIndex = i;
                        matched = true;
                        break;
                    }
                }
            }

            // Populate remarks with stock lot description
            const remarksField = document.getElementById('assort-packetRemarks');
            if (remarksField) {
                remarksField.value = `Stock Lot: ${color} ${size} ${purity}`;
            }

            closeAssortStockPicker();
        }

        function applyAssortManualSelection() {
            const size = document.getElementById('assort-picker-manual-size').value;
            const caratsVal = parseFloat(document.getElementById('assort-picker-manual-carats').value) || 0;

            if (caratsVal <= 0) {
                showCustomAlert("Validation Error", "Please enter a valid carat weight.", "warning");
                return;
            }

            // Set carats
            const caratsField = document.getElementById('assort-caratsGiven');
            if (caratsField) caratsField.value = caratsVal.toFixed(3);

            // Set sieve size
            const cleanSize = (size || "").replace(/ Sieve| size/gi, '').trim().toUpperCase();
            const sieveSelect = document.getElementById('assort-sieveSize');
            if (sieveSelect) {
                for (let i = 0; i < sieveSelect.options.length; i++) {
                    const optVal = sieveSelect.options[i].value.trim().toUpperCase();
                    if (optVal === cleanSize) {
                        sieveSelect.selectedIndex = i;
                        break;
                    }
                }
            }

            // Populate remarks
            const remarksField = document.getElementById('assort-packetRemarks');
            if (remarksField) {
                remarksField.value = `Manual Entry Sieve: ${size}`;
            }

            closeAssortStockPicker();
        }

        // ── Diamond Assortment Desk Controller ─────────────────────────────
        
        function switchAssortTab(tabId) {
            document.querySelectorAll('#view-assortment [id^="assort-tab-"]').forEach(el => el.style.display = 'none');
            document.querySelectorAll('#view-assortment .erp-tab-btn').forEach(btn => btn.classList.remove('active'));
            
            const targetPane = document.getElementById(`assort-tab-${tabId}`);
            if (targetPane) targetPane.style.display = 'block';
            
            const targetBtn = document.getElementById(`btn-assort-${tabId}`);
            if (targetBtn) targetBtn.classList.add('active');
            
            renderAssortmentApp();
        }

        function setAssortFormTimestamps() {
            const now = new Date();
            const dateInput = document.getElementById('assort-issueDate');
            const timeInput = document.getElementById('assort-issueTime');
            if (dateInput) dateInput.value = now.toISOString().split('T')[0];
            if (timeInput) timeInput.value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        }

        function appendStaffToForm(name) {
            const nameField = document.getElementById('assort-personName');
            if (!nameField) return;
            const currentVal = nameField.value.trim();
            if (currentVal === '') {
                nameField.value = name;
            } else {
                const namesArray = currentVal.split(', ').map(n => n.trim());
                if (!namesArray.includes(name)) {
                    namesArray.push(name);
                    nameField.value = namesArray.join(', ');
                }
            }
        }

        function handleStaffFormSubmit(e) {
            e.preventDefault();
            const nameInput = document.getElementById('assort-newStaffName');
            const name = nameInput.value.trim();
            if (name) {
                if (!ERP_STATE.assortStaff.includes(name)) {
                    ERP_STATE.assortStaff.push(name);
                    saveDatabaseState();
                    nameInput.value = '';
                    renderAssortmentApp();
                } else {
                    showCustomAlert("Validation Error", "Employee already exists!", "warning");
                }
            }
        }

        function deleteStaff(name) {
            showCustomConfirm('Remove Staff', `Remove ${name} from your staff catalog?`, () => {
                ERP_STATE.assortStaff = ERP_STATE.assortStaff.filter(item => item !== name);
                saveDatabaseState();
                renderAssortmentApp();
            }, null, 'warning');
        }

        function handleIssueFormSubmit(e) {
            e.preventDefault();
            const packetName = document.getElementById('assort-packetName').value.trim();
            const personName = document.getElementById('assort-personName').value.trim();
            const caratsGiven = parseFloat(document.getElementById('assort-caratsGiven').value);
            const sieveSize = document.getElementById('assort-sieveSize').value;
            const dateVal = document.getElementById('assort-issueDate').value;
            const timeVal = document.getElementById('assort-issueTime').value;
            const purpose = document.getElementById('assort-assortPurpose').value;
            const tool = document.getElementById('assort-toolUsed').value;
            const remarks = document.getElementById('assort-packetRemarks').value.trim() || 'No remarks.';

            if (isNaN(caratsGiven) || caratsGiven <= 0) {
                showCustomAlert("Validation Error", "Please enter a valid given carat weight.", "warning");
                return;
            }

            const customIssuedTimestamp = new Date(`${dateVal}T${timeVal}`).toISOString();

            const record = {
                id: 'JNG-' + Date.now(),
                packetName: packetName,
                name: personName,
                caratsGiven: caratsGiven,
                caratsInBetweenGiven: 0,
                caratsInBetweenReturned: 0,
                sieveSize: sieveSize,
                purpose: purpose,
                tool: tool,
                remarks: remarks,
                timeIssued: customIssuedTimestamp,
                timeFinalReturned: null,
                caratsFinalReturned: 0,
                status: 'In Progress',
                isLocked: true
            };
            
            ERP_STATE.assortRecords.push(record);
            saveDatabaseState();
            renderAssortmentApp();
            
            // Reset form
            document.getElementById('assortIssueForm').reset();
            setAssortFormTimestamps();
            showCustomAlert("Success", "New parcel issued successfully!", "success");
        }

        function adjustInBetween(id, action) {
            const amountInput = document.getElementById(`assort-partial-input-${id}`);
            if (!amountInput) return;
            const amount = parseFloat(amountInput.value);
            if (isNaN(amount) || amount <= 0) {
                showCustomAlert("Validation Error", "Enter valid carat weight!", "warning");
                return;
            }
            
            const record = ERP_STATE.assortRecords.find(r => r.id === id);
            if (!record) return;
            
            if (action === 'add') {
                // Give more carats
                if (record.caratsInBetweenGiven === undefined) record.caratsInBetweenGiven = 0;
                record.caratsInBetweenGiven += amount;
            } else if (action === 'sub') {
                // Receive partial carats
                if (record.caratsInBetweenReturned === undefined) record.caratsInBetweenReturned = 0;
                record.caratsInBetweenReturned += amount;
            }
            
            amountInput.value = '';
            saveDatabaseState();
            renderAssortmentApp();
        }

        function completeJob(id) {
            const finalInput = document.getElementById(`assort-final-input-${id}`);
            const timeInput = document.getElementById(`assort-time-input-${id}`);
            if (!finalInput) return;
            const finalCt = parseFloat(finalInput.value);
            if (isNaN(finalCt) || finalCt < 0) {
                showCustomAlert("Validation Error", "Enter valid final carat weight!", "warning");
                return;
            }

            const record = ERP_STATE.assortRecords.find(r => r.id === id);
            if (!record) return;
            
            record.caratsFinalReturned = finalCt;
            record.status = 'Completed';
            
            const timeOverride = timeInput ? timeInput.value : '';
            if (timeOverride) {
                const now = new Date();
                const [hrs, mins] = timeOverride.split(':');
                const customDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(hrs), parseInt(mins));
                record.timeFinalReturned = customDate.toISOString();
            } else {
                record.timeFinalReturned = new Date().toISOString();
            }

            calculateLearningMetric(record);
            saveDatabaseState();
            renderAssortmentApp();
            showCustomAlert("Success", "Job marked completed successfully!", "success");
        }

        function toggleLock(id) {
            const record = ERP_STATE.assortRecords.find(r => r.id === id);
            if (record) {
                record.isLocked = !record.isLocked;
                saveDatabaseState();
                renderAssortmentApp();
            }
        }

        function updateHistoryField(id, field, value) {
            const record = ERP_STATE.assortRecords.find(r => r.id === id);
            if (!record) return;
            
            if (field === 'caratsGiven') record.caratsGiven = parseFloat(value) || 0;
            if (field === 'totalReturned') {
                const totalTarget = parseFloat(value) || 0;
                const partialRet = record.caratsInBetweenReturned || 0;
                record.caratsFinalReturned = totalTarget - partialRet;
            }
            if (field === 'name') record.name = value;
            if (field === 'packetName') record.packetName = value;
            if (field === 'remarks') record.remarks = value;
            
            saveDatabaseState();
            renderAssortmentApp(); // Update values & metrics
        }

        function calculateLearningMetric(record) {
            const minutesTaken = (new Date(record.timeFinalReturned) - new Date(record.timeIssued)) / 60000;
            if (minutesTaken <= 0) return; 
            
            const partialRet = record.caratsInBetweenReturned || 0;
            const totalReturned = partialRet + record.caratsFinalReturned;
            if (totalReturned === 0) return;

            const currentMinPerCarat = minutesTaken / totalReturned;
            const key = `${record.name.toLowerCase()}_${record.sieveSize}_${record.purpose}_${record.tool}`;

            if (!ERP_STATE.assortLearningMatrix) {
                ERP_STATE.assortLearningMatrix = {};
            }
            if (!ERP_STATE.assortLearningMatrix[key]) {
                ERP_STATE.assortLearningMatrix[key] = { totalJobs: 0, avgMinutesPerCarat: 0 };
            }
            const matrix = ERP_STATE.assortLearningMatrix[key];
            matrix.avgMinutesPerCarat = ((matrix.avgMinutesPerCarat * matrix.totalJobs) + currentMinPerCarat) / (matrix.totalJobs + 1);
            matrix.totalJobs += 1;
            localStorage.setItem('sms_assort_learning_matrix', JSON.stringify(ERP_STATE.assortLearningMatrix));
        }

        function getElapsedString(isoString) {
            const diffMs = new Date() - new Date(isoString);
            const totalMins = Math.floor(diffMs / 60000);
            const hrs = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            return hrs > 0 ? `${hrs}h ${mins}m running` : `${mins}m running`;
        }

        function getExpectedFinishTime(record) {
            const key = `${record.name.toLowerCase()}_${record.sieveSize}_${record.purpose}_${record.tool}`;
            const matrix = ERP_STATE.assortLearningMatrix || {};
            if (matrix[key]) {
                const totalMinutes = matrix[key].avgMinutesPerCarat * record.caratsGiven;
                const issuedTime = new Date(record.timeIssued).getTime();
                const d = new Date(issuedTime + totalMinutes * 60000);
                return (d.getMonth()+1) + '/' + d.getDate() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false});
            }
            return "--";
        }

        function handleLostFoundSubmit(e) {
            e.preventDefault();
            const dateVal = document.getElementById('assort-lfDate').value;
            const typeVal = document.getElementById('assort-lfType').value;
            const caratsVal = parseFloat(document.getElementById('assort-lfCarats').value);
            const remarksVal = document.getElementById('assort-lfRemarks').value.trim();

            if (isNaN(caratsVal) || caratsVal <= 0) {
                showCustomAlert("Validation Error", "Please enter a valid carat weight.", "warning");
                return;
            }

            const entry = {
                id: 'LF-' + Date.now(),
                date: dateVal,
                type: typeVal,
                carats: caratsVal,
                remarks: remarksVal
            };

            if (!ERP_STATE.assortLostFound) {
                ERP_STATE.assortLostFound = [];
            }
            ERP_STATE.assortLostFound.push(entry);
            saveDatabaseState();
            
            // Reset form
            document.getElementById('assortLostFoundForm').reset();
            const lfDateInput = document.getElementById('assort-lfDate');
            if (lfDateInput) lfDateInput.value = new Date().toISOString().split('T')[0];
            
            renderAssortmentApp();
            showCustomAlert("Success", "Lost & Found entry recorded successfully!", "success");
        }

        function deleteLostFoundEntry(id) {
            showCustomConfirm('Delete Entry', 'Remove this settlement entry from record?', () => {
                ERP_STATE.assortLostFound = ERP_STATE.assortLostFound.filter(item => item.id !== id);
                saveDatabaseState();
                renderAssortmentApp();
            }, null, 'warning');
        }

        function clearAllAssortData() {
            showCustomConfirm('Clear Database', 'This will wipe out all active floor jobs, history, and employees list. This is irreversible. Proceed?', () => {
                localStorage.removeItem('sms_assort_records');
                localStorage.removeItem('sms_assort_learning_matrix');
                localStorage.removeItem('sms_assort_staff');
                localStorage.removeItem('sms_assort_lost_found');
                
                ERP_STATE.assortRecords = [];
                ERP_STATE.assortLearningMatrix = {};
                ERP_STATE.assortStaff = [];
                ERP_STATE.assortLostFound = [];
                
                renderAssortmentApp();
                showCustomAlert("Success", "Assortment desk database cleared.", "success");
            }, null, 'danger');
        }

        function exportAssortBackup() {
            const data = {
                records: ERP_STATE.assortRecords,
                matrix: ERP_STATE.assortLearningMatrix,
                staff: ERP_STATE.assortStaff,
                lostfound: ERP_STATE.assortLostFound
            };
            const b64 = btoa(encodeURIComponent(JSON.stringify(data)));
            navigator.clipboard.writeText(b64).then(() => {
                showCustomAlert("Success", "Assortment backup copied to clipboard!", "success");
            }).catch(() => {
                prompt("Copy this backup text:", b64);
            });
        }

        function importAssortBackup() {
            const code = prompt("Paste your backup string here:");
            if (!code) return;
            try {
                const data = JSON.parse(decodeURIComponent(atob(code)));
                if (data.records && data.staff) {
                    ERP_STATE.assortRecords = data.records;
                    ERP_STATE.assortLearningMatrix = data.matrix || {};
                    ERP_STATE.assortStaff = data.staff;
                    ERP_STATE.assortLostFound = data.lostfound || [];
                    saveDatabaseState();
                    renderAssortmentApp();
                    showCustomAlert("Success", "Assortment data imported successfully!", "success");
                } else {
                    showCustomAlert("Import Error", "Invalid backup data layout.", "error");
                }
            } catch (e) {
                showCustomAlert("Import Error", "Failed to decode backup string.", "error");
            }
        }

        function renderAssortmentApp() {
            // Check if user is logged in
            if (!ERP_STATE.isLoggedIn) return;

            // Render tags picker
            const picker = document.getElementById('assort-formArtisanPicker');
            if (picker) {
                if (ERP_STATE.assortStaff.length === 0) {
                    picker.innerHTML = '<span style="color:var(--text-muted); font-size:0.75rem;">No staff registered. Add them in Staff Management tab.</span>';
                } else {
                    picker.innerHTML = ERP_STATE.assortStaff.map(name => `
                        <span class="artisan-tag" onclick="appendStaffToForm('${name}')" style="background:rgba(0,0,0,0.05); padding:4px 8px; border-radius:4px; font-size:11px; font-weight:500; cursor:pointer; border:1px solid #b0b0a8; display:inline-block; transition:all 0.2s;">+ ${name}</span>
                    `).join('');
                }
            }

            // Render staff catalog table
            const staffBody = document.getElementById('assort-staffTableBody');
            if (staffBody) {
                if (ERP_STATE.assortStaff.length === 0) {
                    staffBody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:15px; color:var(--text-muted); font-style:italic;">No employee records found.</td></tr>';
                } else {
                    staffBody.innerHTML = ERP_STATE.assortStaff.map(name => `
                        <tr>
                            <td style="font-weight:600;">${name}</td>
                            <td style="text-align:center;"><button class="erp-btn" style="background:var(--danger-color, #e74c3c); color:white; padding:2px 8px; font-size:0.75rem;" onclick="deleteStaff('${name}')">Delete</button></td>
                        </tr>
                    `).join('');
                }
            }

            // Render lost & found adjustment history table
            const lfBody = document.getElementById('assort-lostFoundTableBody');
            if (lfBody) {
                const lfList = ERP_STATE.assortLostFound || [];
                if (lfList.length === 0) {
                    lfBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:15px; color:var(--text-muted); font-style:italic;">No settlement entries recorded.</td></tr>';
                } else {
                    lfBody.innerHTML = lfList.map(item => `
                        <tr>
                            <td>${item.date}</td>
                            <td><span style="font-weight:bold; color:${item.type === 'Found' ? 'var(--success-color, #2ecc71)' : 'var(--danger-color, #e74c3c)'};">${item.type.toUpperCase()}</span></td>
                            <td style="text-align:right; font-weight:bold;">${item.carats.toFixed(3)} ct</td>
                            <td>${item.remarks}</td>
                            <td style="text-align:center;"><button class="erp-btn" style="background:var(--danger-color, #e74c3c); color:white; padding:2px 8px; font-size:0.75rem;" onclick="deleteLostFoundEntry('${item.id}')">Delete</button></td>
                        </tr>
                    `).join('');
                }
            }

            // Tables active floor & history logs
            const activeBody = document.getElementById('assort-activeFloorBody');
            const historyBody = document.getElementById('assort-historyBody');
            const searchQuery = document.getElementById('assort-tableSearch') ? document.getElementById('assort-tableSearch').value.toLowerCase().trim() : '';

            if (activeBody && historyBody) {
                activeBody.innerHTML = '';
                historyBody.innerHTML = '';
                
                const now = new Date();
                const currentHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
                
                let activeJobs = 0;
                let activeCarats = 0;
                let completedJobs = 0;
                let totalJobLoss = 0;

                const recordsList = ERP_STATE.assortRecords || [];
                recordsList.forEach(r => {
                    const safePacketName = r.packetName || 'Unnamed';
                    const safeRemarks = r.remarks || 'No remarks.';
                    const matchesSearch = safePacketName.toLowerCase().includes(searchQuery) || r.name.toLowerCase().includes(searchQuery);
                    
                    if (searchQuery !== '' && !matchesSearch) return;

                    const partialGiv = r.caratsInBetweenGiven || 0;
                    const partialRet = r.caratsInBetweenReturned || 0;
                    
                    const totalGiven = r.caratsGiven + partialGiv;

                    if (r.status === 'In Progress') {
                        activeJobs++;
                        activeCarats += r.caratsGiven; // Using initial given for Floor inventory stat

                        // Format elapsed time string
                        const dateFormatted = new Date(r.timeIssued).toLocaleDateString() + ' ' + new Date(r.timeIssued).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false});
                        
                        activeBody.innerHTML += `
                            <tr>
                                <td>${dateFormatted}<br><small style="color:#2563eb; font-weight:600;" data-assort-timer="${r.timeIssued}">${getElapsedString(r.timeIssued)}</small></td>
                                <td><span style="color:#002878; font-weight:600;">${safePacketName}</span></td>
                                <td><strong>${r.name}</strong></td>
                                <td><div>SZ: ${r.sieveSize} | ${r.purpose} (${r.tool})</div><div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">📝 ${safeRemarks}</div></td>
                                <td style="text-align:right; font-weight:600;">${r.caratsGiven.toFixed(3)}</td>
                                <td style="text-align:center;">
                                    <div style="font-size:0.78rem; font-weight:bold; margin-bottom:4px;">Gave +${partialGiv.toFixed(3)} | Recv -${partialRet.toFixed(3)}</div>
                                    <div style="display:flex; gap:4px; align-items:center; justify-content:center;">
                                        <input type="number" step="0.001" placeholder="Cts" id="assort-partial-input-${r.id}" style="width:70px; padding:3px; font-size:0.8rem; border:1px solid #b0b0a8; border-radius:4px;">
                                        <button class="erp-btn" style="background:var(--success-color, #2ecc71); color:white; padding:3px 6px; font-size:0.75rem;" onclick="adjustInBetween('${r.id}', 'add')">Give</button>
                                        <button class="erp-btn" style="background:var(--danger-color, #e74c3c); color:white; padding:3px 6px; font-size:0.75rem;" onclick="adjustInBetween('${r.id}', 'sub')">Recv</button>
                                    </div>
                                </td>
                                <td><small>${getExpectedFinishTime(r)}</small></td>
                                <td style="text-align:center;">
                                    <div style="display:flex; flex-direction:column; gap:4px; align-items:center;">
                                        <input type="number" step="0.001" placeholder="Final Returned Weight" id="assort-final-input-${r.id}" style="width:130px; padding:4px; font-size:0.8rem; border:1px solid #b0b0a8; border-radius:4px; text-align:right;">
                                        <div style="display:flex; gap:4px; align-items:center;">
                                            <input type="time" value="${currentHHMM}" id="assort-time-input-${r.id}" style="padding:3px; font-size:0.75rem; border:1px solid #b0b0a8; border-radius:4px; width:70px;">
                                            <button class="erp-btn" style="background:var(--success-color, #2ecc71); color:white; padding:4px 10px; font-size:0.75rem; font-weight:bold;" onclick="completeJob('${r.id}')">Complete</button>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        `;
                    } else {
                        completedJobs++;
                        const totalReturned = partialRet + r.caratsFinalReturned;
                        const variance = totalReturned - totalGiven;
                        
                        const lossPercent = totalGiven > 0 ? (Math.abs(variance) / totalGiven) * 100 : 0;
                        if (variance < 0) {
                            totalJobLoss += Math.abs(variance);
                        }

                        // Style indicator
                        let varianceStyle = 'color:var(--success-color, #2ecc71); font-weight:bold;';
                        if (variance < 0) {
                            varianceStyle = lossPercent > 0.5 ? 'background:#ffedd5; color:var(--warning-color, #f1c40f); font-weight:bold; border-radius:4px; padding:2px 4px; display:inline-block;' : 'color:var(--danger-color, #e74c3c); font-weight:bold;';
                        }

                        const dateIssuedStr = new Date(r.timeIssued).toLocaleDateString() + ' ' + new Date(r.timeIssued).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false});
                        const dateReturnedStr = new Date(r.timeFinalReturned).toLocaleDateString() + ' ' + new Date(r.timeFinalReturned).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', hour12: false});

                        if (r.isLocked) {
                            historyBody.innerHTML += `
                                <tr>
                                    <td style="text-align:center;"><button class="erp-btn" style="padding:2px 8px; font-size:0.75rem; background:rgba(0,0,0,0.05); border:1px solid #b0b0a8;" onclick="toggleLock('${r.id}')">🔒 Unlock Edit</button></td>
                                    <td><small>In: ${dateIssuedStr}<br>Out: ${dateReturnedStr}</small></td>
                                    <td><span style="color:#002878; font-weight:600;">${safePacketName}</span></td>
                                    <td><strong>${r.name}</strong></td>
                                    <td><div>SZ: ${r.sieveSize} | ${r.purpose} (${r.tool})</div><div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">📝 ${safeRemarks}</div></td>
                                    <td style="text-align:right;">${totalGiven.toFixed(3)}</td>
                                    <td style="text-align:right;">${totalReturned.toFixed(3)}</td>
                                    <td style="text-align:right;"><span style="${varianceStyle}">${variance.toFixed(3)} ct</span><br><small style="color:gray;">(${lossPercent.toFixed(2)}%)</small></td>
                                </tr>
                            `;
                        } else {
                            historyBody.innerHTML += `
                                <tr style="background:rgba(231, 76, 60, 0.05);">
                                    <td style="text-align:center;"><button class="erp-btn" style="padding:2px 8px; font-size:0.75rem; background:#fee2e2; color:var(--danger-color, #e74c3c); border:1px solid var(--danger-color, #e74c3c); font-weight:bold;" onclick="toggleLock('${r.id}')">🔓 Lock Row</button></td>
                                    <td><small>In: ${dateIssuedStr}<br>Out: ${dateReturnedStr}</small></td>
                                    <td><input type="text" style="width:90px; padding:3px; font-size:0.8rem; border:1px solid #b0b0a8; border-radius:4px;" value="${safePacketName}" oninput="updateHistoryField('${r.id}', 'packetName', this.value)"></td>
                                    <td><input type="text" style="width:90px; padding:3px; font-size:0.8rem; border:1px solid #b0b0a8; border-radius:4px;" value="${r.name}" oninput="updateHistoryField('${r.id}', 'name', this.value)"></td>
                                    <td>
                                        <div>SZ: ${r.sieveSize} | ${r.purpose}</div>
                                        <textarea style="width:100%; min-height:40px; margin-top:4px; padding:3px; font-size:0.75rem; border:1px solid #b0b0a8; border-radius:4px;" oninput="updateHistoryField('${r.id}', 'remarks', this.value)">${safeRemarks}</textarea>
                                    </td>
                                    <td><input type="number" step="0.001" style="width:80px; padding:3px; font-size:0.8rem; border:1px solid #b0b0a8; border-radius:4px; text-align:right;" value="${r.caratsGiven}" oninput="updateHistoryField('${r.id}', 'caratsGiven', this.value)"></td>
                                    <td><input type="number" step="0.001" style="width:80px; padding:3px; font-size:0.8rem; border:1px solid #b0b0a8; border-radius:4px; text-align:right;" value="${totalReturned}" oninput="updateHistoryField('${r.id}', 'totalReturned', this.value)"></td>
                                    <td style="font-weight:bold; color:var(--text-main); text-align:center;">EDITABLE MODE</td>
                                </tr>
                            `;
                        }
                    }
                });

                if (activeBody.innerHTML === '') {
                    activeBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:15px; color:var(--text-muted); font-style:italic;">No active assorting jobs.</td></tr>';
                }
                if (historyBody.innerHTML === '') {
                    historyBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:15px; color:var(--text-muted); font-style:italic;">No historical completed records.</td></tr>';
                }

                // Update metric counters with Lost & Found Adjustments
                let adjustmentFound = 0;
                let adjustmentLost = 0;
                const lfList = ERP_STATE.assortLostFound || [];
                lfList.forEach(lf => {
                    if (lf.type === 'Found') {
                        adjustmentFound += lf.carats;
                    } else if (lf.type === 'Lost') {
                        adjustmentLost += lf.carats;
                    }
                });

                const netHistoryLoss = totalJobLoss - adjustmentFound + adjustmentLost;

                document.getElementById('assort-dash-active-carats').innerText = activeCarats.toFixed(3) + ' ct';
                document.getElementById('assort-dash-completed-count').innerText = completedJobs;
                document.getElementById('assort-dash-active-workers').innerText = activeJobs + (activeJobs === 1 ? ' Job' : ' Jobs');
                document.getElementById('assort-dash-total-loss').innerText = netHistoryLoss.toFixed(3) + ' ct';
            }
        }

        // ── Database Manual Backup & Recovery Controller ─────────────────
        
        function getCompleteStateObject() {
            return {
                stock: ERP_STATE.stock,
                purchaseLog: ERP_STATE.purchaseLog,
                salesLog: ERP_STATE.salesLog,
                rojmel: ERP_STATE.rojmel,
                invoiceCounters: ERP_STATE.invoiceCounters,
                invoiceMetadata: ERP_STATE.invoiceMetadata,
                payments: ERP_STATE.payments,
                adjEntries: ERP_STATE.adjEntries,
                auditTrail: ERP_STATE.auditTrail,
                masters: ERP_STATE.masters,
                assortRecords: ERP_STATE.assortRecords,
                assortLearningMatrix: ERP_STATE.assortLearningMatrix,
                assortStaff: ERP_STATE.assortStaff,
                assortLostFound: ERP_STATE.assortLostFound
            };
        }

        function restoreStateFromObject(stateObj) {
            if (!stateObj) return false;
            
            if (stateObj.stock) ERP_STATE.stock = stateObj.stock;
            if (stateObj.purchaseLog) ERP_STATE.purchaseLog = stateObj.purchaseLog;
            if (stateObj.salesLog) ERP_STATE.salesLog = stateObj.salesLog;
            if (stateObj.rojmel) ERP_STATE.rojmel = stateObj.rojmel;
            if (stateObj.invoiceCounters) ERP_STATE.invoiceCounters = stateObj.invoiceCounters;
            if (stateObj.invoiceMetadata) ERP_STATE.invoiceMetadata = stateObj.invoiceMetadata;
            if (stateObj.payments) ERP_STATE.payments = stateObj.payments;
            if (stateObj.adjEntries) ERP_STATE.adjEntries = stateObj.adjEntries;
            if (stateObj.auditTrail) ERP_STATE.auditTrail = stateObj.auditTrail;

            if (stateObj.masters) {
                if (stateObj.masters.colors) ERP_STATE.masters.colors = stateObj.masters.colors;
                if (stateObj.masters.sizes) ERP_STATE.masters.sizes = stateObj.masters.sizes;
                if (stateObj.masters.numbers) ERP_STATE.masters.numbers = stateObj.masters.numbers;
                if (stateObj.masters.purities) ERP_STATE.masters.purities = stateObj.masters.purities;
                if (stateObj.masters.parties) ERP_STATE.masters.parties = stateObj.masters.parties;
                if (stateObj.masters.brokers) ERP_STATE.masters.brokers = stateObj.masters.brokers;
                if (stateObj.masters.seriesPurities) ERP_STATE.masters.seriesPurities = stateObj.masters.seriesPurities;
            }
            
            if (stateObj.assortRecords) ERP_STATE.assortRecords = stateObj.assortRecords;
            if (stateObj.assortLearningMatrix) ERP_STATE.assortLearningMatrix = stateObj.assortLearningMatrix;
            if (stateObj.assortStaff) ERP_STATE.assortStaff = stateObj.assortStaff;
            if (stateObj.assortLostFound) ERP_STATE.assortLostFound = stateObj.assortLostFound;
            
            saveDatabaseState();
            refreshAllMasterSelectors();
            renderAllDataComponents();
            return true;
        }

        function createManualBackup() {
            const now = new Date();
            // Format name with date & time to prevent duplicate confusion
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hour = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const sec = String(now.getSeconds()).padStart(2, '0');
            
            const backupName = `Backup_${year}-${month}-${day}_${hour}-${min}-${sec}`;
            const stateData = getCompleteStateObject();
            
            const newBackup = {
                id: 'BK-' + now.getTime(),
                name: backupName,
                timestamp: now.getTime(),
                data: btoa(encodeURIComponent(JSON.stringify(stateData)))
            };
            
            if (!ERP_STATE.manualBackups) ERP_STATE.manualBackups = [];
            ERP_STATE.manualBackups.push(newBackup);
            ERP_STATE.lastManualBackupTime = now.getTime();
            
            saveDatabaseState();
            
            renderBackupHistory();
            updateBackupReminderUI();
            
            showCustomAlert("Success", `✅ Manual backup created successfully:\n${backupName}`, "success");
        }

        function restoreManualBackup(id) {
            const backup = ERP_STATE.manualBackups.find(b => b.id === id);
            if (!backup) return;
            
            showCustomConfirm('Restore Backup', `Are you sure you want to restore the backup [${backup.name}]?\nThis will overwrite all active logs and database stats.`, () => {
                try {
                    const decryptedData = JSON.parse(decodeURIComponent(atob(backup.data)));
                    const ok = restoreStateFromObject(decryptedData);
                    if (ok) {
                        showCustomAlert("Success", "✅ Active database restored successfully from local backup!", "success");
                    } else {
                        showCustomAlert("Error", "❌ Failed to parse or apply backup properties.", "error");
                    }
                } catch (e) {
                    showCustomAlert("Error", "❌ Corrupt or invalid backup data format.", "error");
                }
            }, null, 'warning');
        }

        function deleteManualBackup(id) {
            const backup = ERP_STATE.manualBackups.find(b => b.id === id);
            if (!backup) return;
            
            showCustomConfirm('Delete Backup', `Are you sure you want to delete backup [${backup.name}]? This is permanent.`, () => {
                ERP_STATE.manualBackups = ERP_STATE.manualBackups.filter(b => b.id !== id);
            saveDatabaseState();
                renderBackupHistory();
                showCustomAlert("Deleted", "Backup entry deleted successfully.", "success");
            }, null, 'warning');
        }

        function importBackupFromString() {
            const code = prompt("Paste your manual backup code string below:");
            if (!code) return;
            
            try {
                const decryptedData = JSON.parse(decodeURIComponent(atob(code)));
                if (decryptedData.stock || decryptedData.purchaseLog || decryptedData.assortRecords) {
                    showCustomConfirm('Confirm Override', 'Valid database state detected. Do you want to restore this state and overwrite your active database?', () => {
                        const ok = restoreStateFromObject(decryptedData);
                        if (ok) {
                            showCustomAlert("Success", "✅ Active database restored successfully from external string!", "success");
                        }
                    }, null, 'warning');
                } else {
                    showCustomAlert("Import Error", "Invalid backup parameters layout.", "error");
                }
            } catch (e) {
                showCustomAlert("Import Error", "Failed to decode backup string.", "error");
            }
        }

        function renderBackupHistory() {
            const body = document.getElementById('backup-history-body');
            if (!body) return;
            
            const list = ERP_STATE.manualBackups || [];
            if (list.length === 0) {
                body.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:15px; color:var(--text-muted); font-style:italic;">No saved manual backups found in local storage.</td></tr>';
                return;
            }
            
            // Render in reverse chronological order (newest backups first)
            const sortedList = [...list].sort((a, b) => b.timestamp - a.timestamp);
            
            body.innerHTML = sortedList.map(b => {
                const dateStr = new Date(b.timestamp).toLocaleDateString() + ' ' + new Date(b.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                return `
                    <tr style="border-bottom: 1px solid rgba(0,0,0,0.05);">
                        <td style="padding: 6px; font-weight: 600; font-family: monospace; font-size:0.8rem;">${b.name}</td>
                        <td style="padding: 6px; text-align: center; display: flex; gap: 4px; justify-content: center;">
                            <button class="erp-btn" style="background: #002878; color: white; padding: 2px 8px; font-size: 0.72rem; font-weight: bold;" onclick="restoreManualBackup('${b.id}')">Restore</button>
                            <button class="erp-btn" style="background: var(--danger-color, #e74c3c); color: white; padding: 2px 8px; font-size: 0.72rem; font-weight: bold;" onclick="deleteManualBackup('${b.id}')">Delete</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function updateBackupReminderUI() {
            const banner = document.getElementById('backup-reminder-banner');
            if (!banner) return;
            
            const lastTime = ERP_STATE.lastManualBackupTime;
            const now = Date.now();
            
            if (!lastTime) {
                // No backup yet
                banner.style.background = 'rgba(231, 76, 60, 0.15)';
                banner.style.borderLeft = '4px solid var(--danger-color, #e74c3c)';
                banner.style.color = '#c0392b';
                banner.innerHTML = `<span>⚠️ <strong>Action Required:</strong> You have not created any manual backups yet. Please perform a manual backup now!</span>`;
                return;
            }
            
            const elapsedDays = (now - lastTime) / (1000 * 60 * 60 * 24);
            const dateStr = new Date(lastTime).toLocaleDateString() + ' ' + new Date(lastTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            
            if (elapsedDays > 7) {
                // More than 7 days ago
                banner.style.background = 'rgba(241, 196, 15, 0.15)';
                banner.style.borderLeft = '4px solid var(--warning-color, #f1c40f)';
                banner.style.color = '#7f6000';
                banner.innerHTML = `<span>⚠️ <strong>Backup Overdue:</strong> Your last manual backup was on <strong>${dateStr}</strong> (more than a week ago). Please back up your data!</span>`;
            }
        }

        // ── Keyboard Shortcuts Settings Editor & Capturer ──
        function renderShortcutsTable() {
            const tbody = document.getElementById('settings-shortcuts-body');
            if (!tbody) return;
            const shortcuts = ERP_STATE.shortcuts || {};
            tbody.innerHTML = Object.keys(shortcuts).map(action => {
                const val = shortcuts[action];
                return `
                    <tr>
                        <td style="padding: 10px; border: 1px solid var(--border); font-weight: bold; font-size: 0.85rem;">${action}</td>
                        <td style="padding: 10px; border: 1px solid var(--border); cursor: pointer;" 
                            ondblclick="editShortcutCell(this, '${action}')" 
                            title="Double click to edit">
                            ${val.display ? `
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span class="shortcut-display-badge">${val.display}</span>
                                    <button onclick="event.stopPropagation(); clearShortcutKey('${action}')" 
                                            style="background: #e74c3c; color: white; border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 0.75rem; font-weight: bold; line-height: 1;" 
                                            title="Clear shortcut">✖</button>
                                </div>
                            ` : `
                                <span style="color: #999; font-style: italic; font-size: 0.8rem;">None (Double-click to set)</span>
                            `}
                        </td>
                        <td style="padding: 10px; border: 1px solid var(--border); text-align: center;">
                            <input type="checkbox" 
                                   ${val.active !== false ? 'checked' : ''} 
                                   onchange="toggleShortcutActive('${action}', this.checked)" 
                                   style="width: 16px; height: 16px; cursor: pointer;">
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function toggleShortcutActive(action, isChecked) {
            if (ERP_STATE.shortcuts && ERP_STATE.shortcuts[action]) {
                ERP_STATE.shortcuts[action].active = isChecked;
                saveDatabaseState();
            }
        }

        function clearShortcutKey(action) {
            if (ERP_STATE.shortcuts && ERP_STATE.shortcuts[action]) {
                ERP_STATE.shortcuts[action].key = "";
                ERP_STATE.shortcuts[action].ctrlKey = false;
                ERP_STATE.shortcuts[action].altKey = false;
                ERP_STATE.shortcuts[action].shiftKey = false;
                ERP_STATE.shortcuts[action].display = "";
                saveDatabaseState();
                renderShortcutsTable();
            }
        }

        function editShortcutCell(td, action) {
            if (td.classList.contains('editing')) return;
            td.classList.add('editing');
            td.innerHTML = `<span style="background: #002878; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; animation: pulse 1s infinite; font-family: monospace; font-size: 0.8rem;">Press keys...</span>`;
            
            const keydownHandler = function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) {
                    return;
                }
                
                const parts = [];
                if (e.ctrlKey) parts.push('Ctrl');
                if (e.altKey) parts.push('Alt');
                if (e.shiftKey) parts.push('Shift');
                parts.push(e.key.toUpperCase());
                
                const displayStr = parts.join('+');
                
                ERP_STATE.shortcuts[action] = Object.assign({}, ERP_STATE.shortcuts[action], {
                    key: e.key.toLowerCase(),
                    ctrlKey: e.ctrlKey,
                    altKey: e.altKey,
                    shiftKey: e.shiftKey,
                    display: displayStr
                });
                
                saveDatabaseState();
                
                cleanup();
                renderShortcutsTable();
                showCustomAlert("Shortcut Updated", `Shortcut for "${action}" set to ${displayStr}`, "success");
            };
            
            const clickAwayHandler = function(e) {
                if (!td.contains(e.target)) {
                    cleanup();
                    renderShortcutsTable();
                }
            };
            
            function cleanup() {
                window.removeEventListener('keydown', keydownHandler, true);
                window.removeEventListener('click', clickAwayHandler, true);
                td.classList.remove('editing');
            }
            
            window.addEventListener('keydown', keydownHandler, true);
            setTimeout(() => {
                window.addEventListener('click', clickAwayHandler, true);
            }, 100);
        }

        // ── Validation Overrides Gate ──
        ERP_STATE.forceOverride = false;
        function toggleForceOverride(type) {
            ERP_STATE.forceOverride = true;
            if (type === 'pur' || type === 'sale') {
                addSheetRow(type);
            } else if (type === 'mix') {
                executeStockMix();
            }
        }

        // ── Drawer UI Controller ──
        function toggleAnalyticsDrawer() {
            const panel = document.getElementById('analytics-side-panel');
            const btn = document.getElementById('analytics-toggle-btn');
            if (panel.classList.contains('open')) {
                panel.classList.remove('open');
                if (btn) btn.style.right = '0';
            } else {
                panel.classList.add('open');
                if (btn) btn.style.right = '400px';
                updateAnalyticsCharts();
            }
        }

        // ── SVG Analytics Engine ──
        function updateAnalyticsCharts() {
            const containersA = [document.getElementById('chart-a-container'), document.getElementById('dashboard-chart-a')].filter(Boolean);
            const containersB = [document.getElementById('chart-b-container'), document.getElementById('dashboard-chart-b')].filter(Boolean);
            if (containersA.length === 0 && containersB.length === 0) return;

            // --- CHART A: Purchase Volume by Shade ---
            const purchases = ERP_STATE.purchaseLog || [];
            if (purchases.length === 0) {
                containersA.forEach(c => {
                    c.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.8rem;">No purchase records available.</div>`;
                });
            } else {
                const shadeData = {};
                purchases.forEach(p => {
                    const shade = p.color || 'Unknown';
                    const sz = p.size || '';
                    const sizeGroup = sz.includes('-2') ? '-2' : (sz.includes('+2') ? '+2' : (sz.includes('MIX') ? 'MIX' : 'Other'));
                    if (!shadeData[shade]) {
                        shadeData[shade] = { '-2': 0, '+2': 0, 'MIX': 0, 'Other': 0, total: 0 };
                    }
                    shadeData[shade][sizeGroup] += p.carats;
                    shadeData[shade].total += p.carats;
                });

                const shades = Object.keys(shadeData).slice(0, 5);
                let maxVal = Math.max(...shades.map(s => shadeData[s].total), 10);

                const width = 340;
                const height = 180;
                const padLeft = 40;
                const padRight = 10;
                const padTop = 15;
                const padBottom = 25;
                const chartW = width - padLeft - padRight;
                const chartH = height - padTop - padBottom;

                let yAxisHtml = '';
                for (let i = 0; i <= 4; i++) {
                    const val = (maxVal * i / 4).toFixed(1);
                    const y = padTop + chartH - (chartH * i / 4);
                    yAxisHtml += `
                        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="rgba(0,0,0,0.06)" stroke-dasharray="2 2"/>
                        <text x="${padLeft - 5}" y="${y + 4}" fill="#6b7280" font-size="9" text-anchor="end">${val}</text>
                    `;
                }

                const barW = Math.min(30, chartW / (shades.length || 1) - 15);
                const colW = chartW / (shades.length || 1);

                let barsHtml = '';
                shades.forEach((shade, idx) => {
                    const data = shadeData[shade];
                    const x = padLeft + idx * colW + (colW - barW) / 2;
                    
                    const sizes = ['-2', '+2', 'MIX', 'Other'];
                    const colors = { '-2': '#3b82f6', '+2': '#10b981', 'MIX': '#f59e0b', 'Other': '#9ca3af' };
                    
                    let currentY = padTop + chartH;
                    sizes.forEach(size => {
                        const val = data[size];
                        if (val <= 0) return;
                        const h = (val / maxVal) * chartH;
                        const y = currentY - h;
                        barsHtml += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${colors[size]}" rx="2"/>`;
                        currentY = y;
                    });

                    barsHtml += `<text x="${padLeft + idx * colW + colW / 2}" y="${height - 8}" fill="#4b5563" font-size="8" text-anchor="middle" font-weight="bold">${shade}</text>`;
                });

                containersA.forEach(c => {
                    c.innerHTML = `
                        <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}">
                            ${yAxisHtml}
                            ${barsHtml}
                            <line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="#9ca3af" stroke-width="1"/>
                        </svg>
                        <div style="display:flex; justify-content:center; gap:8px; font-size:0.68rem; margin-top:5px; flex-wrap:wrap;">
                            <span style="display:flex; align-items:center; gap:3px;"><span style="display:inline-block; width:8px; height:8px; background:#3b82f6; border-radius:2px;"></span>-2</span>
                            <span style="display:flex; align-items:center; gap:3px;"><span style="display:inline-block; width:8px; height:8px; background:#10b981; border-radius:2px;"></span>+2</span>
                            <span style="display:flex; align-items:center; gap:3px;"><span style="display:inline-block; width:8px; height:8px; background:#f59e0b; border-radius:2px;"></span>MIX</span>
                            <span style="display:flex; align-items:center; gap:3px;"><span style="display:inline-block; width:8px; height:8px; background:#9ca3af; border-radius:2px;"></span>Other</span>
                        </div>
                    `;
                });
            }

            // --- CHART B: Sales Margin Distribution ---
            const sales = ERP_STATE.salesLog || [];
            if (sales.length === 0) {
                containersB.forEach(c => {
                    c.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.8rem;">No sales records available.</div>`;
                });
            } else {
                const buckets = { 'Loss (<0%)': 0, 'Low (0-5%)': 0, 'Medium (5-15%)': 0, 'High (>15%)': 0 };
                sales.forEach(l => {
                    const cleanSize = (l.size || '').toString().replace(/ Sieve| size/gi, '').trim();
                    const costRate = getAveragePurchaseRate(cleanSize, l.clarity);
                    const profit = Number(l.amount || 0) - (Number(l.carats || 0) * costRate);
                    const marginPct = Number(l.amount || 0) > 0 ? (profit / Number(l.amount || 0)) * 100 : 0;

                    if (marginPct < 0) buckets['Loss (<0%)']++;
                    else if (marginPct <= 5) buckets['Low (0-5%)']++;
                    else if (marginPct <= 15) buckets['Medium (5-15%)']++;
                    else buckets['High (>15%)']++;
                });

                const categories = Object.keys(buckets);
                const maxVal = Math.max(...categories.map(c => buckets[c]), 5);

                const width = 340;
                const height = 180;
                const padLeft = 30;
                const padRight = 10;
                const padTop = 15;
                const padBottom = 25;
                const chartW = width - padLeft - padRight;
                const chartH = height - padTop - padBottom;

                let yAxisHtml = '';
                for (let i = 0; i <= 4; i++) {
                    const val = Math.round(maxVal * i / 4);
                    const y = padTop + chartH - (chartH * i / 4);
                    yAxisHtml += `
                        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="rgba(0,0,0,0.06)" stroke-dasharray="2 2"/>
                        <text x="${padLeft - 5}" y="${y + 4}" fill="#6b7280" font-size="9" text-anchor="end">${val}</text>
                    `;
                }

                const barW = 35;
                const colW = chartW / 4;
                const colors = { 'Loss (<0%)': '#ef4444', 'Low (0-5%)': '#f59e0b', 'Medium (5-15%)': '#3b82f6', 'High (>15%)': '#10b981' };
                const displayNames = { 'Loss (<0%)': 'Loss', 'Low (0-5%)': '0-5%', 'Medium (5-15%)': '5-15%', 'High (>15%)': '>15%' };

                let barsHtml = '';
                categories.forEach((cat, idx) => {
                    const val = buckets[cat];
                    const x = padLeft + idx * colW + (colW - barW) / 2;
                    const h = (val / maxVal) * chartH;
                    const y = padTop + chartH - h;

                    barsHtml += `
                        <rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${colors[cat]}" rx="3"/>
                        <text x="${x + barW / 2}" y="${y - 4}" fill="${colors[cat]}" font-size="9" font-weight="bold" text-anchor="middle">${val}</text>
                        <text x="${padLeft + idx * colW + colW / 2}" y="${height - 8}" fill="#4b5563" font-size="8.5" text-anchor="middle" font-weight="bold">${displayNames[cat]}</text>
                    `;
                });

                containersB.forEach(c => {
                    c.innerHTML = `
                        <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}">
                            ${yAxisHtml}
                            ${barsHtml}
                            <line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="#9ca3af" stroke-width="1"/>
                        </svg>
                    `;
                });
            }
        }

        // ── WhatsApp Broadcast Engine Logic ──
        function toggleWaScheduleField() {
            const mode = document.getElementById('wa-delivery-mode').value;
            const group = document.getElementById('wa-schedule-group');
            if (group) {
                group.style.display = (mode === 'Schedule') ? 'block' : 'none';
            }
        }

        function updateWhatsAppPreview() {
            const previewEl = document.getElementById('wa-body-preview');
            if (!previewEl) return "";

            let m2Carats = 0;
            let p2Carats = 0;
            
            if (ERP_STATE.stock) {
                for (const [key, carats] of Object.entries(ERP_STATE.stock)) {
                    const [col, sz, pur] = key.split('||');
                    const cleanSz = sz.replace(/ Sieve| size/gi, '').trim();
                    if (cleanSz === '-2') {
                        m2Carats += carats;
                    } else if (cleanSz === '+2') {
                        p2Carats += carats;
                    }
                }
            }

            const firmName = ERP_STATE.adminUsername || 'Nirbhay Gems';
            const today = new Date();
            const day = String(today.getDate()).padStart(2, '0');
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const year = today.getFullYear();
            const formattedDate = `${day}-${month}-${year}`;

            const includeSummaryOnly = document.getElementById('wa-summary-only').checked;
            const customNote = document.getElementById('wa-custom-note').value.trim();

            let msg = `*🟢 ${firmName} Stock Update*\n`;
            msg += `📅 Date: ${formattedDate}\n\n`;
            msg += `Hello, please find our latest polished diamond inventory summary below:\n\n`;
            msg += `*📊 Stock Breakdown:*\n`;
            msg += `▪️ *-2 Sieve:* ${m2Carats.toFixed(2)} carats\n`;
            msg += `▪️ *+2 Sieve:* ${p2Carats.toFixed(2)} carats\n`;
            msg += `▪️ *Shade:* Light Brown (LB)\n`;

            if (!includeSummaryOnly) {
                msg += `\nFor detailed lot pricing, sieve millimeter variances, or to place a booking, please contact our desk at the Bharat Diamond Bourse or reply directly to this message.`;
            }

            if (customNote) {
                msg += `\n\n${customNote}`;
            }

            msg += `\n\nThank you for doing business with us!`;

            let htmlMsg = msg
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/\*(.*?)\*/g, '<strong>$1</strong>');

            previewEl.innerHTML = htmlMsg;
            return msg;
        }

        function generateWhatsAppPayload() {
            const rawNumbers = document.getElementById('wa-recipients').value.trim();
            const deliveryMode = document.getElementById('wa-delivery-mode').value;
            const scheduleInstr = document.getElementById('wa-schedule-instruction').value.trim();

            const recipientsList = rawNumbers.split(',')
                .map(num => num.trim())
                .filter(num => num.length > 0)
                .map(num => {
                    if (!num.startsWith('+')) {
                        if (num.startsWith('91') && num.length > 10) {
                            return '+' + num;
                        } else {
                            return '+91' + num;
                        }
                    }
                    return num;
                });

            if (recipientsList.length === 0) {
                recipientsList.push("+91XXXXXXXXXX");
            }

            const bodyText = updateWhatsAppPreview();

            let status = "READY";
            let deliveryTimestamp = "IMMEDIATE";

            if (deliveryMode === 'Schedule') {
                status = "SCHEDULED";
                deliveryTimestamp = calculateISOForInstruction(scheduleInstr);
            }

            const payload = {
                status: status,
                delivery_timestamp: deliveryTimestamp,
                recipients: recipientsList,
                whatsapp_payload: {
                    messaging_product: "whatsapp",
                    type: "text",
                    text: {
                        body: bodyText
                    }
                }
            };

            document.getElementById('wa-payload-output').innerText = JSON.stringify(payload, null, 2);
            showCustomAlert("Success", "WhatsApp payload generated successfully.", "success");
        }

        function calculateISOForInstruction(instruction) {
            if (!instruction) {
                return getNextFriday5PMISO();
            }

            const lower = instruction.toLowerCase();
            if (lower.includes('friday') && lower.includes('5') && lower.includes('pm')) {
                return getNextFriday5PMISO();
            }

            try {
                const d = new Date(instruction);
                if (!isNaN(d.getTime())) {
                    return d.toISOString();
                }
            } catch(e) {}

            return getNextFriday5PMISO();
        }

        function getNextFriday5PMISO() {
            const now = new Date();
            const resultDate = new Date();
            const dayOfWeek = 5;
            const currentDay = now.getDay();
            let distance = dayOfWeek - currentDay;
            if (distance <= 0) {
                distance += 7;
            }
            resultDate.setDate(now.getDate() + distance);
            resultDate.setHours(17, 0, 0, 0);
            return resultDate.toISOString();
        }

        function copyWhatsAppPayload() {
            const text = document.getElementById('wa-payload-output').innerText;
            if (!text) {
                showCustomAlert("Info", "Please generate the JSON payload first.", "warning");
                return;
            }
            navigator.clipboard.writeText(text).then(() => {
                showCustomAlert("Copied", "JSON payload copied to clipboard.", "success");
            }).catch(err => {
                console.error("Failed to copy text", err);
                showCustomAlert("Error", "Failed to copy payload.", "error");
            });
        }

        // ── Custom Searchable Suggestion Dropdown Popups Controller ──
        let activeSearchMenuTarget = null;
        let activeSearchMenuType = '';
        let searchMenuSelectedIndex = -1;

        function openSearchMenu(inputEl, type) {
            if (inputEl.disabled) return;

            const popup = document.getElementById('erp-custom-search-menu');
            if (activeSearchMenuTarget === inputEl && activeSearchMenuType === type) {
                if (popup && popup.style.display === 'flex') {
                    return; // Already open for this target
                }
            }
            
            // Close any existing open search menus first
            closeSearchMenu();

            activeSearchMenuTarget = inputEl;
            activeSearchMenuType = type;
            searchMenuSelectedIndex = -1;

            const titleEl = document.getElementById('search-menu-title');
            const labelEl = document.getElementById('search-menu-label');
            const inputField = document.getElementById('search-menu-input');

            if (type === 'party') {
                titleEl.innerText = "SEARCH PARTY";
                labelEl.innerText = "Party Name";
            } else if (type === 'broker') {
                titleEl.innerText = "SEARCH BROKER";
                labelEl.innerText = "Broker Name";
            } else if (type === 'shade') {
                titleEl.innerText = "SEARCH SHADE";
                labelEl.innerText = "Shade / Color";
            } else if (type === 'size') {
                titleEl.innerText = "SEARCH SIZE";
                labelEl.innerText = "Size";
            } else if (type === 'number') {
                titleEl.innerText = "SEARCH NUMBER";
                labelEl.innerText = "Number / Purity";
            } else if (type === 'purity') {
                titleEl.innerText = "SEARCH PURITY";
                labelEl.innerText = "Purity";
            }

            inputField.value = "";

            // Bounding box positioning with right edge clipping safety
            const rect = inputEl.getBoundingClientRect();
            if (popup) {
                popup.style.display = 'flex';
                popup.style.position = 'absolute';
                popup.style.top = (window.scrollY + rect.bottom + 2) + 'px';
                
                const isWideType = (type === 'shade' || type === 'size' || type === 'number');
                const popupWidth = isWideType ? Math.max(rect.width, 250) : Math.max(rect.width, 320);
                
                let leftPos = window.scrollX + rect.left;
                const viewportWidth = window.innerWidth;
                
                if (rect.left + popupWidth > viewportWidth) {
                    leftPos = window.scrollX + viewportWidth - popupWidth - 10;
                }
                
                popup.style.left = Math.max(0, leftPos) + 'px';
                popup.style.width = popupWidth + 'px';
            }

            populateSearchMenuOptions();

            setTimeout(() => {
                if (inputField) inputField.focus();
            }, 50);
        }

        function populateSearchMenuOptions() {
            const container = document.getElementById('search-menu-options');
            if (!container) return;
            const inputField = document.getElementById('search-menu-input');
            const filterText = inputField ? inputField.value.trim().toLowerCase() : '';
            
            let list = [];
            let addNewText = '';
            if (activeSearchMenuType === 'party') {
                list = ERP_STATE.masters.parties || [];
                addNewText = '+ Add New Party';
            } else if (activeSearchMenuType === 'broker') {
                list = ERP_STATE.masters.brokers || [];
                addNewText = '+ Add New Broker';
            } else if (activeSearchMenuType === 'shade') {
                list = ERP_STATE.masters.colors || [];
                addNewText = '+ Add New Shade';
            } else if (activeSearchMenuType === 'size') {
                list = ERP_STATE.masters.sizes || [];
                addNewText = '+ Add New Size';
            } else if (activeSearchMenuType === 'number') {
                list = ERP_STATE.masters.numbers || [];
                addNewText = '+ Add New Number';
            } else if (activeSearchMenuType === 'purity') {
                list = ERP_STATE.masters.purities || [];
                addNewText = '+ Add New Purity';
            }

            let filteredList = list.filter(item => {
                if (!item) return false;
                return item.toString().toLowerCase().includes(filterText);
            });

            let html = '';
            
            // Add New option at the top (only for invoice entry forms)
            const isEntryInput = activeSearchMenuTarget && (activeSearchMenuTarget.id.startsWith('pur-') || activeSearchMenuTarget.id.startsWith('sale-'));
            if (addNewText && isEntryInput && addNewText.toLowerCase().includes(filterText)) {
                html += `<div class="search-menu-opt add-new-opt" onclick="selectSearchMenuOption('${addNewText.replace(/'/g, "\\'")}')">${addNewText}</div>`;
            }

            filteredList.forEach(item => {
                if (item) {
                    const escapedVal = item.toString().replace(/'/g, "\\'");
                    html += `<div class="search-menu-opt" onclick="selectSearchMenuOption('${escapedVal}')">${item}</div>`;
                }
            });

            container.innerHTML = html;
            searchMenuSelectedIndex = -1;
        }

        function filterSearchMenuOptions() {
            populateSearchMenuOptions();
        }

        function selectSearchMenuOption(value) {
            if (!activeSearchMenuTarget) return;

            if (value.startsWith('+ Add New')) {
                const type = activeSearchMenuType;
                const targetId = activeSearchMenuTarget.id;
                closeSearchMenu();
                
                openQuickMasterModal(type, targetId);
                return;
            }

            activeSearchMenuTarget.value = value;
            activeSearchMenuTarget.dispatchEvent(new Event('change'));

            const targetId = activeSearchMenuTarget.id;
            closeSearchMenu();

            // Auto navigate to next input field
            if (targetId === 'pur-form-party') {
                focusAndOpenMenu('pur-form-broker', 'broker');
            } else if (targetId === 'pur-form-broker') {
                const daysField = document.getElementById('pur-form-days');
                if (daysField) daysField.focus();
            } else if (targetId === 'sale-form-party') {
                focusAndOpenMenu('sale-form-broker', 'broker');
            } else if (targetId === 'sale-form-broker') {
                // For sales broker selection, trigger stock picker
                const val = document.getElementById('sale-form-broker').value;
                if (val && val !== '+ Add New Broker') {
                    openStockPicker();
                }
            } else if (targetId === 'pur-sheet-shade') {
                focusAndOpenMenu('pur-sheet-size', 'size');
            } else if (targetId === 'pur-sheet-size') {
                focusAndOpenMenu('pur-sheet-number', 'number');
            } else if (targetId === 'pur-sheet-number') {
                const caratsField = document.getElementById('pur-sheet-carats');
                if (caratsField) caratsField.focus();
            }

            // Update party balance display in payment entry
            if (targetId === 'payment-party') {
                updatePaymentPartyBalanceDisplay();
                const amtField = document.getElementById('payment-amount');
                if (amtField) amtField.focus();
            }
        }

        function focusAndOpenMenu(id, type) {
            const el = document.getElementById(id);
            if (el) {
                el.focus();
                openSearchMenu(el, type);
            }
        }

        function closeSearchMenu() {
            const popup = document.getElementById('erp-custom-search-menu');
            if (popup) popup.style.display = 'none';
            activeSearchMenuTarget = null;
            activeSearchMenuType = '';
            searchMenuSelectedIndex = -1;
        }

        // Suggestion keydown navigation and outside click handlers
        document.addEventListener('DOMContentLoaded', () => {
            const searchInput = document.getElementById('search-menu-input');
            if (searchInput) {
                searchInput.addEventListener('keydown', (e) => {
                    const container = document.getElementById('search-menu-options');
                    const options = container.querySelectorAll('.search-menu-opt');
                    if (options.length === 0) return;

                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        searchMenuSelectedIndex++;
                        if (searchMenuSelectedIndex >= options.length) {
                            searchMenuSelectedIndex = 0;
                        }
                        updateSearchMenuSelection(options);
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        searchMenuSelectedIndex--;
                        if (searchMenuSelectedIndex < 0) {
                            searchMenuSelectedIndex = options.length - 1;
                        }
                        updateSearchMenuSelection(options);
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        let indexToSelect = searchMenuSelectedIndex;
                        if (indexToSelect === -1) {
                            indexToSelect = 0;
                        }
                        const opt = options[indexToSelect];
                        if (opt) {
                            opt.click();
                        }
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        closeSearchMenu();
                        if (activeSearchMenuTarget) activeSearchMenuTarget.focus();
                    }
                });
            }

            document.addEventListener('mousedown', (e) => {
                const popup = document.getElementById('erp-custom-search-menu');
                if (popup && popup.style.display === 'flex') {
                    if (!popup.contains(e.target) && !e.target.classList.contains('erp-custom-select') && e.target !== activeSearchMenuTarget) {
                        closeSearchMenu();
                    }
                }
            });
        });

        function updateSearchMenuSelection(options) {
            options.forEach((opt, idx) => {
                if (idx === searchMenuSelectedIndex) {
                    opt.classList.add('selected');
                    opt.scrollIntoView({ block: 'nearest' });
                } else {
                    opt.classList.remove('selected');
                }
            });
        }
