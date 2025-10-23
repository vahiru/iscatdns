document.addEventListener('DOMContentLoaded', () => {
    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const response = await fetch('/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (response.ok) {
                    window.location.href = '/login';
                } else {
                    alert('登出失败。');
                }
            } catch (error) {
                console.error('登出错误:', error);
                alert('登出时发生错误。');
            }
        });
    }

    const dnsRecordsTableBody = document.getElementById('dnsRecordsTableBody');
    const addRecordForm = document.getElementById('addRecordForm');
    const searchRecordsInput = document.getElementById('searchRecords');

    let allDnsRecords = []; // Store all fetched records for filtering

    // Function to fetch and render DNS records
    async function fetchAndRenderDnsRecords() {
        dnsRecordsTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center">加载中...</td>
            </tr>
        `;
        try {
            const response = await fetch('/api/dns/records');
            if (response.ok) {
                const records = await response.json();
                allDnsRecords = records; // Store all records
                renderDnsRecords(allDnsRecords); // Render all initially
            } else {
                dnsRecordsTableBody.innerHTML = `<tr><td colspan="6" class="text-center">加载记录失败。</td></tr>`;
            }
        } catch (error) {
            console.error('Error fetching DNS records:', error);
            dnsRecordsTableBody.innerHTML = `<tr><td colspan="6" class="text-center">加载记录时发生错误。</td></tr>`;
        }
    }

    // Function to render DNS records (can be filtered)
    function renderDnsRecords(recordsToRender) {
        dnsRecordsTableBody.innerHTML = '';
        if (recordsToRender.length === 0) {
            dnsRecordsTableBody.innerHTML = `<tr><td colspan="6" class="text-center">暂无 DNS 记录。</td></tr>`;
        } else {
            recordsToRender.forEach(record => {
                const row = `
                    <tr>
                        <td>${record.type}</td>
                        <td>${record.name}</td>
                        <td>${record.content}</td>
                        <td>${record.ttl}</td>
                        <td>${record.proxied ? '是' : '否'}</td>
                        <td>
                            <button class="btn btn-sm btn-danger delete-record" data-id="${record.id}">删除</button>
                        </td>
                    </tr>
                `;
                dnsRecordsTableBody.innerHTML += row;
            });
            // Add event listeners for delete buttons
            document.querySelectorAll('.delete-record').forEach(button => {
                button.addEventListener('click', handleDeleteRecord);
            });
        }
    }

    // Handle add record form submission
    if (addRecordForm) {
        addRecordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(addRecordForm);
            const recordData = Object.fromEntries(formData.entries());
            
            try {
                const response = await fetch('/api/dns/records', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(recordData)
                });
                if (response.ok) {
                    addRecordForm.reset();
                    fetchAndRenderDnsRecords(); // Re-fetch and render records
                } else {
                    const errorData = await response.json();
                    alert(`添加记录失败: ${errorData.message || response.statusText}`);
                }
            } catch (error) {
                console.error('Error adding DNS record:', error);
                alert('添加记录时发生错误。');
            }
        });
    }

    // Handle domain delegation form submission
    const delegateForm = document.getElementById('delegateForm');
    if (delegateForm) {
        delegateForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(delegateForm);
            const subdomain = formData.get('subdomain');
            const nameserversString = formData.get('nameservers');
            const nameservers = nameserversString.split(',').map(ns => ns.trim()).filter(ns => ns.length > 0);

            if (!subdomain || nameservers.length === 0) {
                alert('子域名和 NS 服务器不能为空。');
                return;
            }

            try {
                const response = await fetch('/api/delegate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subdomain, nameservers })
                });
                if (response.ok) {
                    const result = await response.json();
                    alert(`委派成功: ${result.message}`);
                    delegateForm.reset();
                } else {
                    const errorData = await response.json();
                    alert(`委派失败: ${errorData.message || response.statusText}`);
                }
            } catch (error) {
                console.error('Error delegating domain:', error);
                alert('委派时发生错误。');
            }
        });
    }

    // Handle delete record
    async function handleDeleteRecord(e) {
        const recordId = e.target.dataset.id;
        if (!confirm('确定要删除此记录吗？')) {
            return;
        }

        try {
            const response = await fetch(`/api/dns/records/${recordId}`, {
                method: 'DELETE',
            });
            if (response.ok) {
                fetchAndRenderDnsRecords(); // Re-fetch and render records
            } else {
                const errorData = await response.json();
                alert(`删除记录失败: ${errorData.message || response.statusText}`);
            }
        } catch (error) {
            console.error('Error deleting DNS record:', error);
            alert('删除记录时发生错误。');
        }
    }

    // Handle search/filter
    if (searchRecordsInput) {
        searchRecordsInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const filteredRecords = allDnsRecords.filter(record => 
                record.type.toLowerCase().includes(searchTerm) ||
                record.name.toLowerCase().includes(searchTerm) ||
                record.content.toLowerCase().includes(searchTerm)
            );
            renderDnsRecords(filteredRecords);
        });
    }

    // Initial fetch of records when the page loads
    fetchAndRenderDnsRecords();

    // Background image rotation logic
    let backgroundImages = [];

    async function fetchBackgroundImages() {
        try {
            const response = await fetch('/api/background-images');
            if (response.ok) {
                const data = await response.json();
                backgroundImages = data.images;
                if (backgroundImages.length > 0) {
                    setRandomBackground();
                    setInterval(setRandomBackground, 10000); // Change background every 10 seconds
                }
            }
        } catch (error) {
            console.error('Error fetching background images:', error);
        }
    }

    function setRandomBackground() {
        if (backgroundImages.length > 0) {
            const randomIndex = Math.floor(Math.random() * backgroundImages.length);
            const imageUrl = `/images/${backgroundImages[randomIndex]}`;
            document.body.style.backgroundImage = `url('${imageUrl}')`;
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
            document.body.style.backgroundAttachment = 'fixed';
        }
    }

    // Initialize background image rotation when DOM is loaded
    fetchBackgroundImages();
});
