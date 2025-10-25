document.addEventListener('DOMContentLoaded', async () => {
    const logoutButton = document.getElementById('logoutButton');
    const loggedInUserSpan = document.getElementById('loggedInUser');
    const adminNavDropdown = document.getElementById('adminNavDropdown');
    const adminPanel = document.getElementById('adminPanel');

    const myDnsRecordsTableBody = document.getElementById('myDnsRecordsTableBody');
    const myApplicationsTableBody = document.getElementById('myApplicationsTableBody');

    const adminUsersTableBody = document.getElementById('adminUsersTableBody');
    const adminDnsRecordsTableBody = document.getElementById('adminDnsRecordsTableBody');
    const adminApplicationsTableBody = document.getElementById('adminApplicationsTableBody');
    const adminAbuseReportsTableBody = document.getElementById('adminAbuseReportsTableBody');

    const bindTelegramSection = document.getElementById('bind-telegram-section');
    const generateTokenBtn = document.getElementById('generateTokenBtn');
    const tokenDisplay = document.getElementById('tokenDisplay');

    let currentUser = null; // To store current user's data

    // --- Helper Functions ---
    async function fetchData(url) {
        const response = await fetch(url);
        if (response.status === 401) {
            window.location.href = '/login';
            return null;
        }
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    }

    function displayMessage(elementId, message, isSuccess) {
        const element = document.getElementById(elementId);
        element.textContent = message;
        element.className = `mt-3 text-center ${isSuccess ? 'text-success' : 'text-danger'}`;
    }

    function formatDate(dateString) {
        const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        return new Date(dateString).toLocaleDateString('zh-CN', options);
    }

    // --- User Data Fetching and Display ---
    async function fetchCurrentUser() {
        try {
            currentUser = await fetchData('/api/user/me');
            if (currentUser) {
                loggedInUserSpan.textContent = `欢迎, ${currentUser.username} (${currentUser.role === 'admin' ? '管理员' : '用户'})`;
                if (currentUser.role === 'admin') {
                    adminNavDropdown.classList.remove('d-none');
                    adminPanel.classList.remove('d-none');
                    if (!currentUser.telegram_user_id) {
                        bindTelegramSection.classList.remove('d-none');
                    }
                    await fetchAdminData();
                }
            }
        } catch (error) {
            console.error('Error fetching current user:', error);
            window.location.href = '/login';
        }
    }

    async function fetchMyDnsRecords() {
        try {
            const records = await fetchData('/api/dns/records');
            renderMyDnsRecords(records);
        } catch (error) {
            console.error('Error fetching my DNS records:', error);
            myDnsRecordsTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">加载记录失败。</td></tr>`;
        }
    }

    async function fetchMyApplications() {
        try {
            const applications = await fetchData('/api/applications'); // Need to create this API endpoint
            renderMyApplications(applications);
        }
        catch (error) {
            console.error('Error fetching my applications:', error);
            myApplicationsTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">加载申请失败。</td></tr>`;
        }
    }

    // --- Admin Data Fetching and Display ---
    async function fetchAdminData() {
        try {
            const [users, dnsRecords, applications, abuseReports] = await Promise.all([
                fetchData('/api/admin/users'),
                fetchData('/api/admin/dns-records'),
                fetchData('/api/admin/applications'),
                fetchData('/api/admin/abuse-reports')
            ]);
            renderAdminUsers(users);
            renderAdminDnsRecords(dnsRecords);
            renderAdminApplications(applications);
            renderAdminAbuseReports(abuseReports);
        } catch (error) {
            console.error('Error fetching admin data:', error);
            // Display error messages in respective admin tables
            adminUsersTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">加载用户失败。</td></tr>`;
            adminDnsRecordsTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">加载所有DNS记录失败。</td></tr>`;
            adminApplicationsTableBody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">加载所有申请失败。</td></tr>`;
            adminAbuseReportsTableBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">加载滥用举报失败。</td></tr>`;
        }
    }

    // --- Rendering Functions ---
    function renderMyDnsRecords(records) {
        myDnsRecordsTableBody.innerHTML = '';
        if (records && records.length > 0) {
            records.forEach(record => {
                const row = myDnsRecordsTableBody.insertRow();
                row.innerHTML = `
                    <td>${record.type}</td>
                    <td>${record.name}</td>
                    <td>${record.content}</td>
                    <td>${record.ttl}</td>
                    <td>${record.proxied ? '是' : '否'}</td>
                    <td>
                        <button class="btn btn-sm btn-warning edit-record-btn" data-id="${record.id}" data-type="${record.type}" data-name="${record.name}" data-content="${record.content}">修改</button>
                        <button class="btn btn-sm btn-danger delete-record-btn" data-id="${record.id}">删除</button>
                    </td>
                `;
            });
        } else {
            myDnsRecordsTableBody.innerHTML = `<tr><td colspan="6" class="text-center">暂无 DNS 记录。</td></tr>`;
        }
    }

    function renderMyApplications(applications) {
        myApplicationsTableBody.innerHTML = '';
        if (applications && applications.length > 0) {
            applications.forEach(app => {
                const row = myApplicationsTableBody.insertRow();
                row.innerHTML = `
                    <td>${app.request_type === 'create' ? '创建' : '更新'}</td>
                    <td>${app.subdomain}</td>
                    <td>${app.record_value}</td>
                    <td>${app.purpose || '无'}</td>
                    <td>${app.status}</td>
                    <td>${formatDate(app.created_at)}</td>
                `;
            });
        } else {
            myApplicationsTableBody.innerHTML = `<tr><td colspan="6" class="text-center">暂无申请记录。</td></tr>`;
        }
    }

    function renderAdminUsers(users) {
        adminUsersTableBody.innerHTML = '';
        if (users && users.length > 0) {
            users.forEach(user => {
                const row = adminUsersTableBody.insertRow();
                const isCurrentUser = user.id === currentUser.id;
                row.innerHTML = `
                    <td>${user.id}</td>
                    <td>${user.username} ${isCurrentUser ? '(您)' : ''}</td>
                    <td>${user.email || 'N/A'}</td>
                    <td>${user.role}</td>
                    <td>${user.telegram_user_id || '未绑定'}</td>
                    <td>${formatDate(user.created_at)}</td>
                    <td>
                        ${!isCurrentUser ? `
                            <button class="btn btn-sm ${user.role === 'admin' ? 'btn-secondary' : 'btn-success'} admin-role-btn" data-id="${user.id}" data-role="${user.role === 'admin' ? 'user' : 'admin'}">
                                ${user.role === 'admin' ? '降级为用户' : '提升为管理员'}
                            </button>
                        ` : ''}
                    </td>
                `;
            });

            adminUsersTableBody.querySelectorAll('.admin-role-btn').forEach(button => {
                button.addEventListener('click', () => handleRoleChange(button.dataset.id, button.dataset.role));
            });
        } else {
            adminUsersTableBody.innerHTML = `<tr><td colspan="7" class="text-center">暂无用户。</td></tr>`;
        }
    }

    function renderAdminDnsRecords(records) {
        adminDnsRecordsTableBody.innerHTML = '';
        if (records && records.length > 0) {
            records.forEach(record => {
                const row = adminDnsRecordsTableBody.insertRow();
                row.innerHTML = `
                    <td>${record.username}</td>
                    <td>${record.type}</td>
                    <td>${record.name}</td>
                    <td>${record.content}</td>
                    <td>${record.ttl}</td>
                    <td>${record.proxied ? '是' : '否'}</td>
                    <td>${formatDate(record.created_at)}</td>
                `;
            });
        } else {
            adminDnsRecordsTableBody.innerHTML = `<tr><td colspan="7" class="text-center">暂无 DNS 记录。</td></tr>`;
        }
    }

    function renderAdminApplications(applications) {
        adminApplicationsTableBody.innerHTML = '';
        if (applications && applications.length > 0) {
            applications.forEach(app => {
                const row = adminApplicationsTableBody.insertRow();
                row.innerHTML = `
                    <td>${app.id}</td>
                    <td>${app.username}</td>
                    <td>${app.request_type === 'create' ? '创建' : '更新'}</td>
                    <td>${app.subdomain}</td>
                    <td>${app.record_value}</td>
                    <td>${app.purpose || '无'}</td>
                    <td>${app.status}</td>
                    <td>${formatDate(app.created_at)}</td>
                    <td>${formatDate(app.voting_deadline_at)}</td>
                    <td>${app.telegram_message_id || 'N/A'}</td>
                `;
            });
        }
        else {
            adminApplicationsTableBody.innerHTML = `<tr><td colspan="10" class="text-center">暂无申请。</td></tr>`;
        }
    }

    function renderAdminAbuseReports(reports) {
        adminAbuseReportsTableBody.innerHTML = '';
        if (reports && reports.length > 0) {
            reports.forEach(report => {
                const row = adminAbuseReportsTableBody.insertRow();
                row.innerHTML = `
                    <td>${report.id}</td>
                    <td>${report.subdomain}</td>
                    <td>${report.reason}</td>
                    <td>${report.details || '无'}</td>
                    <td>${report.reporter_ip || '未知'}</td>
                    <td>${report.status}</td>
                    <td>${formatDate(report.created_at)}</td>
                    <td>
                        ${report.status === 'new' || report.status === 'acknowledged' ? `
                            <button class="btn btn-sm btn-info admin-abuse-acknowledge-btn" data-id="${report.id}">受理</button>
                            <button class="btn btn-sm btn-danger admin-abuse-suspend-btn" data-id="${report.id}">暂停域名</button>
                            <button class="btn btn-sm btn-secondary admin-abuse-ignore-btn" data-id="${report.id}">忽略</button>
                        ` : '已处理'}
                    </td>
                `;
            });
            // Add event listeners for abuse report actions
            adminAbuseReportsTableBody.querySelectorAll('.admin-abuse-acknowledge-btn').forEach(button => {
                button.addEventListener('click', () => handleAdminAbuseAction(button.dataset.id, 'acknowledge'));
            });
            adminAbuseReportsTableBody.querySelectorAll('.admin-abuse-suspend-btn').forEach(button => {
                button.addEventListener('click', () => handleAdminAbuseAction(button.dataset.id, 'suspend'));
            });
            adminAbuseReportsTableBody.querySelectorAll('.admin-abuse-ignore-btn').forEach(button => {
                button.addEventListener('click', () => handleAdminAbuseAction(button.dataset.id, 'ignore'));
            });
        } else {
            adminAbuseReportsTableBody.innerHTML = `<tr><td colspan="8" class="text-center">暂无滥用举报。</td></tr>`;
        }
    }

    // --- Event Handlers ---
    logoutButton.addEventListener('click', async (event) => {
        event.preventDefault();
        await fetch('/logout', { method: 'POST' });
        window.location.href = '/login';
    });

    // Application Form Submission
    const applicationForm = document.getElementById('applicationForm');
    const applicationFormMessage = document.getElementById('applicationFormMessage');
    applicationForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(applicationForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const response = await fetch('/api/dns/records', { // This endpoint now handles applications
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (response.ok) {
                displayMessage('applicationFormMessage', result.message, true);
                applicationForm.reset();
                fetchMyApplications(); // Refresh user's applications
            } else {
                displayMessage('applicationFormMessage', result.message || '提交申请失败。' + (result.error ? `: ${result.error}` : ''), false);
            }
        } catch (error) {
            console.error('Error submitting application:', error);
            displayMessage('applicationFormMessage', '网络错误或服务器无响应。' + (error.message ? `: ${error.message}` : ''), false);
        }
    });

    // Edit Record (triggers update application)
    myDnsRecordsTableBody.addEventListener('click', async (event) => {
        if (event.target.classList.contains('edit-record-btn')) {
            const recordId = event.target.dataset.id;
            const recordType = event.target.dataset.type;
            const recordName = event.target.dataset.name;
            const recordContent = event.target.dataset.content;

            // Populate application form for update
            document.getElementById('appRecordType').value = recordType;
            document.getElementById('appRecordName').value = recordName;
            document.getElementById('appRecordContent').value = recordContent;
            document.getElementById('appPurpose').value = `更新记录 ID: ${recordId}`; // Pre-fill purpose

            // Change form to update mode (optional, for now just pre-fill)
            applicationForm.dataset.mode = 'update';
            applicationForm.dataset.recordId = recordId;
            document.getElementById('applicationForm').querySelector('button[type="submit"]').textContent = '提交更新申请';
            displayMessage('applicationFormMessage', '请填写用途并提交更新申请。' + (recordId ? ` (原记录ID: ${recordId})` : ''), true);
            window.scrollTo({ top: document.getElementById('apply-subdomain').offsetTop, behavior: 'smooth' });
        }
    });

    // Delete Record (direct deletion)
    myDnsRecordsTableBody.addEventListener('click', async (event) => {
        if (event.target.classList.contains('delete-record-btn')) {
            const recordId = event.target.dataset.id;
            if (confirm('确定要删除此记录吗？此操作无法撤销。' + (recordId ? ` (记录ID: ${recordId})` : ''))) {
                try {
                    const response = await fetch(`/api/dns/records/${recordId}`, {
                        method: 'DELETE'
                    });
                    if (response.ok) {
                        alert('记录删除成功！');
                        fetchMyDnsRecords(); // Refresh records
                    } else {
                        const errorData = await response.json();
                        alert(`删除失败: ${errorData.message || response.statusText}`);
                    }
                } catch (error) {
                    console.error('Error deleting record:', error);
                    alert('网络错误或服务器无响应，删除失败。' + (error.message ? `: ${error.message}` : ''));
                }
            }
        }
    });

    // Admin Abuse Report Actions
    async function handleAdminAbuseAction(reportId, action) {
        if (!confirm(`确定要执行此操作 (${action}) 吗？` + (reportId ? ` (举报ID: ${reportId})` : ''))) {
            return;
        }
        try {
            const response = await fetch(`/api/admin/abuse-reports/${reportId}/${action}`, {
                method: 'POST'
            });
            const result = await response.json();
            if (response.ok) {
                alert(result.message);
                fetchAdminData(); // Refresh admin data
            } else {
                alert(`操作失败: ${result.message || response.statusText}`);
            }
        } catch (error) {
            console.error(`Error performing admin action ${action} on report ${reportId}:`, error);
            alert('网络错误或服务器无响应，操作失败。' + (error.message ? `: ${error.message}` : ''));
        }
    }

    // --- Initial Load ---
    await fetchCurrentUser();
    await fetchMyDnsRecords();
    await fetchMyApplications();

    // Search functionality (simple client-side filtering)
    document.getElementById('searchMyRecords').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        myDnsRecordsTableBody.querySelectorAll('tr').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(searchTerm) ? '' : 'none';
        });
    });

    document.getElementById('searchAllRecords').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        adminDnsRecordsTableBody.querySelectorAll('tr').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(searchTerm) ? '' : 'none';
        });
    });

    document.getElementById('searchAllApplications').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        adminApplicationsTableBody.querySelectorAll('tr').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(searchTerm) ? '' : 'none';
        });
    });

    document.getElementById('searchAbuseReports').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        adminAbuseReportsTableBody.querySelectorAll('tr').forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(searchTerm) ? '' : 'none';
        });
    });

    generateTokenBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/api/user/me/generate-bind-token', { method: 'POST' });
            const result = await response.json();
            if (response.ok) {
                tokenDisplay.querySelector('code').textContent = `/bind ${result.token}`;
                tokenDisplay.classList.remove('d-none');
                generateTokenBtn.disabled = true;
                generateTokenBtn.textContent = '令牌已生成';
            } else {
                alert(`生成令牌失败: ${result.message}`);
            }
        } catch (error) {
            console.error('Error generating token:', error);
            alert('生成令牌时发生网络错误。');
        }
    });

    async function handleRoleChange(userId, newRole) {
        if (!confirm(`确定要将用户 ${userId} 的角色变更为 ${newRole} 吗？`)) {
            return;
        }
        try {
            const response = await fetch(`/api/admin/users/${userId}/set-role`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole })
            });
            const result = await response.json();
            if (response.ok) {
                alert(result.message);
                fetchAdminData(); // Refresh user list
            } else {
                alert(`操作失败: ${result.message}`);
            }
        } catch (error) {
            console.error('Error changing role:', error);
            alert('更改角色时发生网络错误。');
        }
    }
});
