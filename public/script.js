document.addEventListener('DOMContentLoaded', () => {
    const appliancesContainer = document.getElementById('appliances-container');
    const scheduleForm = document.getElementById('schedule-form');
    const nodeIndicator = document.getElementById('node-indicator');
    const nodeLabel = nodeIndicator.querySelector('.label');

    // Fetch and update appliances
    async function fetchAppliances() {
        try {
            const response = await fetch('/api/appliances');
            const appliances = await response.json();
            renderAppliances(appliances);
        } catch (error) {
            console.error('Error fetching appliances:', error);
        }
    }

    // Fetch and update node status
    async function fetchNodeStatus() {
        try {
            const response = await fetch('/api/node-status');
            const status = await response.json();
            if (status.online) {
                nodeIndicator.classList.add('online');
                nodeLabel.textContent = 'Node Online';
            } else {
                nodeIndicator.classList.remove('online');
                nodeLabel.textContent = 'Node Offline';
            }
        } catch (error) {
            console.error('Error fetching node status:', error);
        }
    }

    const applianceIcons = {
        1: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.7 1.5-1.7 1.5-2.7a3.5 3.5 0 1 0-7 0c0 1 .5 2 1.5 2.7.8.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`, // Light
        2: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`, // TV/Monitor
        3: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M18.8 6c.4.4.4 1 0 1.4l-4.4 4.4 4.4 4.4c.4.4.4 1 0 1.4-.4.4-1 .4-1.4 0l-4.4-4.4-4.4 4.4c-.4.4-1 .4-1.4 0-.4-.4-.4-1 0-1.4l4.4-4.4-4.4-4.4c-.4-.4-.4-1 0-1.4.4-.4 1-.4 1.4 0l4.4 4.4 4.4-4.4c.4-.4 1-.4 1.4 0z"/></svg>`, // Fan (X icon for now as placeholder)
        4: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>` // general appliance / bolt
    };

    function renderAppliances(appliances) {
        appliancesContainer.innerHTML = '';
        appliances.forEach(appliance => {
            const card = document.createElement('div');
            card.className = 'card';

            const stateText = appliance.state === 1 ? 'Running' : 'Stanby';
            const badgeClass = appliance.state === 1 ? 'on' : 'off';
            const nextState = appliance.state === 1 ? 0 : 1;
            const btnText = appliance.state === 1 ? 'Power Off' : 'Power On';
            const icon = applianceIcons[appliance.id] || applianceIcons[4];

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div class="appliance-id">Device ${appliance.id}</div>
                    <div class="status-badge ${badgeClass}">${stateText}</div>
                </div>
                <div class="appliance-info">
                    <div style="padding: 1rem; background: rgba(255,255,255,0.05); border-radius: 1rem; color: ${appliance.state === 1 ? 'var(--primary)' : 'var(--text-muted)'}; transition: color 0.3s;">
                        ${icon}
                    </div>
                    <span style="font-weight: 600; font-size: 0.9rem;">Socket ${appliance.id}</span>
                </div>
                <button class="btn btn-toggle" onclick="toggleAppliance(${appliance.id}, ${nextState})">
                    ${btnText}
                </button>
            `;
            appliancesContainer.appendChild(card);
        });
    }

    // Toggle appliance state
    window.toggleAppliance = async (id, state) => {
        try {
            await fetch(`/api/appliance/${id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state })
            });
            // We wait for polling to update UI as per spec
        } catch (error) {
            console.error('Error toggling appliance:', error);
        }
    };

    async function fetchSchedules() {
        try {
            const response = await fetch('/api/schedules');
            const schedules = await response.json();
            renderSchedules(schedules);
        } catch (error) {
            console.error('Error fetching schedules:', error);
        }
    }

    function renderSchedules(schedules) {
        const schedulesBody = document.getElementById('schedules-body');
        if (!schedulesBody) return;

        if (schedules.length === 0) {
            schedulesBody.innerHTML = '<tr><td colspan="4" class="text-center">No schedules found</td></tr>';
            return;
        }

        schedulesBody.innerHTML = '';
        schedules.forEach(schedule => {
            const row = document.createElement('tr');

            const triggerDate = new Date(schedule.trigger_time * 1000).toLocaleString();
            const actionText = schedule.target_state === 1 ? 'Turn ON' : 'Turn OFF';
            const statusClass = `status-${schedule.status}`;

            row.innerHTML = `
                <td>Appliance ${schedule.appliance_id}</td>
                <td>${actionText}</td>
                <td>${triggerDate}</td>
                <td class="${statusClass}">${schedule.status.charAt(0).toUpperCase() + schedule.status.slice(1)}</td>
            `;
            schedulesBody.appendChild(row);
        });
    }

    // Handle schedule form submission
    scheduleForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const appliance_id = parseInt(document.getElementById('appliance_id').value);
        const state = parseInt(document.getElementById('target_state').value);
        const datetimeLocal = document.getElementById('trigger_time').value;
        const trigger_time = Math.floor(new Date(datetimeLocal).getTime() / 1000);

        try {
            const response = await fetch('/api/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appliance_id, state, trigger_time })
            });
            const result = await response.json();
            if (result.success) {
                scheduleForm.reset();
                fetchSchedules(); // Refresh schedules immediately
            }
        } catch (error) {
            console.error('Error creating schedule:', error);
        }
    });

    // Initial fetch
    fetchAppliances();
    fetchNodeStatus();
    fetchSchedules();

    // Polling
    setInterval(fetchAppliances, 2000);
    setInterval(fetchNodeStatus, 2000);
    setInterval(fetchSchedules, 5000); // Poll schedules less frequently
});
