/**
 * ZyroFlow Modern Chart.js Analytics Suite
 * 5 High-End Animated Visualizers with Real Database Integration, Auto Light/Dark Theme Switching & Real-Time Refreshes
 */

const ZyroAnalytics = (function () {
  'use strict';

  let chartInstances = {};
  let lastData = null;

  // Helper: Detect current theme
  function isDarkMode() {
    const docTheme = document.documentElement.getAttribute('data-theme');
    if (docTheme) return docTheme === 'dark';
    return document.body.classList.contains('dark-theme') || !document.body.classList.contains('light-theme');
  }

  // Helper: Get Theme Config
  function getThemeColors() {
    const dark = isDarkMode();
    return {
      textColor: dark ? '#B8C4D6' : '#1e293b',
      titleColor: dark ? '#FFFFFF' : '#0f172a',
      gridColor: dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.1)',
      tooltipBg: dark ? '#0F172A' : '#FFFFFF',
      tooltipText: dark ? '#FFFFFF' : '#111827',
      tooltipBorder: dark ? '#2D415F' : '#E5E7EB'
    };
  }

  // Helper: Canvas Element Lookup with Fallbacks
  function getCanvasElement(candidateIds) {
    for (const id of candidateIds) {
      const el = document.getElementById(id);
      if (el) return { canvas: el, id };
    }
    return null;
  }

  // Center Percentage / Custom Text Doughnut Plugin
  const centerTextPlugin = {
    id: 'centerTextPlugin',
    afterDraw(chart) {
      if (chart.config.type !== 'doughnut') return;
      const { ctx, chartArea } = chart;
      if (!chartArea) return;

      const pluginOpts = chart.config.options?.plugins || {};
      if (pluginOpts.disableCenterText || pluginOpts.centerTextPlugin === false) return;

      const theme = getThemeColors();

      const valText = pluginOpts.centerTextValue !== undefined
        ? pluginOpts.centerTextValue
        : `${pluginOpts.centerTextRate ?? 0}%`;

      const labelText = pluginOpts.centerTextLabel !== undefined
        ? pluginOpts.centerTextLabel
        : 'Approval Rate';

      ctx.save();
      const centerX = (chartArea.left + chartArea.right) / 2;
      const centerY = (chartArea.top + chartArea.bottom) / 2;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Value Number
      ctx.font = 'bold 24px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = theme.titleColor;
      ctx.fillText(String(valText), centerX, centerY - 8);

      // Label Subtitle
      if (labelText) {
        ctx.font = '500 12px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = theme.textColor;
        ctx.fillText(String(labelText), centerX, centerY + 14);
      }

      ctx.restore();
    }
  };

  // Register Custom Plugin once
  if (typeof Chart !== 'undefined') {
    try { Chart.register(centerTextPlugin); } catch (e) { }
  }

  // 1. Smooth Area Chart (Approval Trend)
  function initApprovalTrendChart(canvasObj, trendData) {
    if (!canvasObj || !canvasObj.canvas) return;
    const { canvas, id } = canvasObj;

    if (chartInstances[id]) {
      chartInstances[id].destroy();
    }

    const theme = getThemeColors();

    // Generate last 7 days date map to ensure smooth continuous area chart
    const dateMap = {};
    const dateLabels = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().split('T')[0];
      dateLabels.push(iso);
      dateMap[iso] = { approved: 0, rejected: 0 };
    }

    // Populate with real DB data
    (trendData || []).forEach((row) => {
      const dtStr = String(row.date || row.timestamp || '').split('T')[0];
      if (dtStr) {
        if (!dateMap[dtStr]) {
          dateMap[dtStr] = { approved: 0, rejected: 0 };
          if (!dateLabels.includes(dtStr)) dateLabels.push(dtStr);
        }
        dateMap[dtStr].approved += Number(row.approved || 0);
        dateMap[dtStr].rejected += Number(row.rejected || 0);
      }
    });

    dateLabels.sort();

    const approvedData = dateLabels.map(d => dateMap[d] ? dateMap[d].approved : 0);
    const rejectedData = dateLabels.map(d => dateMap[d] ? dateMap[d].rejected : 0);

    console.log('[ZyroAnalytics] Approval Trend Dataset:', { labels: dateLabels, approved: approvedData, rejected: rejectedData });

    // Gradients
    const ctx2d = canvas.getContext('2d');
    const gradientApproved = ctx2d.createLinearGradient(0, 0, 0, 300);
    gradientApproved.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
    gradientApproved.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

    const gradientRejected = ctx2d.createLinearGradient(0, 0, 0, 300);
    gradientRejected.addColorStop(0, 'rgba(239, 68, 68, 0.35)');
    gradientRejected.addColorStop(1, 'rgba(239, 68, 68, 0.0)');

    chartInstances[id] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: dateLabels,
        datasets: [
          {
            label: 'Approved',
            data: approvedData,
            borderColor: '#38BDF8',
            backgroundColor: gradientApproved,
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#38BDF8',
            pointRadius: 4,
            pointHoverRadius: 6
          },
          {
            label: 'Rejected',
            data: rejectedData,
            borderColor: '#EF4444',
            backgroundColor: gradientRejected,
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#EF4444',
            pointRadius: 4,
            pointHoverRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        scales: {
          x: {
            grid: { color: theme.gridColor },
            ticks: { color: theme.textColor, font: { size: 12 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: theme.gridColor },
            ticks: { color: theme.textColor, font: { size: 12 }, precision: 0 }
          }
        },
        plugins: {
          legend: { labels: { color: theme.textColor, font: { size: 13, weight: '600' } } },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8
          }
        }
      }
    });
  }

  // 2. Animated Doughnut Chart with Center Percentage (Status Distribution)
  function initStatusDoughnutChart(canvasObj, distData, approvalRate) {
    if (!canvasObj || !canvasObj.canvas) return;
    const { canvas, id } = canvasObj;

    if (chartInstances[id]) {
      chartInstances[id].destroy();
    }

    const theme = getThemeColors();
    const dist = distData || {};

    const pending = Number(dist.pending || 0);
    const approved = Number(dist.approved || 0);
    const rejected = Number(dist.rejected || 0);
    const escalated = Number(dist.escalated || 0);

    console.log('[ZyroAnalytics] Status Doughnut Dataset:', { approved, pending, rejected, escalated, approvalRate });

    chartInstances[id] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Approved', 'Pending', 'Rejected', 'Escalated'],
        datasets: [{
          data: [approved, pending, rejected, escalated],
          backgroundColor: ['#10B981', '#F59E0B', '#EF4444', '#F97316'],
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '74%',
        animation: { animateScale: true, animateRotate: true, duration: 1000 },
        plugins: {
          centerTextRate: approvalRate || 0,
          legend: {
            position: 'bottom',
            labels: { color: theme.textColor, padding: 16, font: { size: 12, weight: '500' } }
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
          }
        }
      }
    });
  }

  // 3. Approval Speed Horizontal Bar Chart
  function initApprovalSpeedChart(canvasObj, speedData) {
    if (!canvasObj || !canvasObj.canvas) return;
    const { canvas, id } = canvasObj;

    if (chartInstances[id]) {
      chartInstances[id].destroy();
    }

    const theme = getThemeColors();
    const list = Array.isArray(speedData) && speedData.length > 0 ? speedData : [];

    // Map stages cleanly
    const stageMap = { Accounts: 0, Manager: 0, CFO: 0, MD: 0 };
    list.forEach((item) => {
      const st = String(item.stage || 'Manager').trim();
      stageMap[st] = Number(item.avg_mins || 0);
    });

    const labels = Object.keys(stageMap);
    const mins = Object.values(stageMap);

    console.log('[ZyroAnalytics] Approval Speed Dataset:', { labels, mins });

    chartInstances[id] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Avg Decision Time (mins)',
          data: mins,
          backgroundColor: '#38BDF8',
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800 },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: theme.gridColor },
            ticks: { color: theme.textColor, font: { size: 12 } }
          },
          y: {
            grid: { display: false },
            ticks: { color: theme.textColor, font: { size: 12, weight: '600' } }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
          }
        }
      }
    });
  }

  // 4. Monthly Requests Gradient Bar Chart
  function initMonthlyRequestsChart(canvasObj, monthlyData) {
    if (!canvasObj || !canvasObj.canvas) return;
    const { canvas, id } = canvasObj;

    if (chartInstances[id]) {
      chartInstances[id].destroy();
    }

    const theme = getThemeColors();
    const list = Array.isArray(monthlyData) && monthlyData.length > 0 ? monthlyData : [];

    const labels = list.map(item => item.month || 'Month');
    const counts = list.map(item => Number(item.count || 0));

    console.log('[ZyroAnalytics] Monthly Requests Dataset:', { labels, counts });

    const ctx2d = canvas.getContext('2d');
    const gradientBar = ctx2d.createLinearGradient(0, 0, 0, 300);
    gradientBar.addColorStop(0, '#2563EB');
    gradientBar.addColorStop(1, '#38BDF8');

    chartInstances[id] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels.length > 0 ? labels : ['Current Month'],
        datasets: [{
          label: 'Requests Count',
          data: counts.length > 0 ? counts : [0],
          backgroundColor: gradientBar,
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800 },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: theme.textColor, font: { size: 12 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: theme.gridColor },
            ticks: { color: theme.textColor, font: { size: 12 }, precision: 0 }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
          }
        }
      }
    });
  }

  // 5. Workflow Funnel Chart
  function initWorkflowFunnelChart(canvasObj, funnelData) {
    if (!canvasObj || !canvasObj.canvas) return;
    const { canvas, id } = canvasObj;

    if (chartInstances[id]) {
      chartInstances[id].destroy();
    }

    const theme = getThemeColors();
    const list = Array.isArray(funnelData) && funnelData.length > 0 ? funnelData : [];

    const stageMap = { Accounts: 0, Manager: 0, CFO: 0, MD: 0, Completed: 0 };
    list.forEach((item) => {
      const st = String(item.stage || 'Accounts').trim();
      stageMap[st] = Number(item.count || 0);
    });

    const labels = Object.keys(stageMap);
    const counts = Object.values(stageMap);

    console.log('[ZyroAnalytics] Workflow Funnel Dataset:', { labels, counts });

    chartInstances[id] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Active Requests',
          data: counts,
          backgroundColor: ['#6366F1', '#3B82F6', '#0EA5E9', '#14B8A6', '#10B981'],
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800 },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: theme.textColor, font: { size: 12, weight: '600' } }
          },
          y: {
            beginAtZero: true,
            grid: { color: theme.gridColor },
            ticks: { color: theme.textColor, font: { size: 12 }, precision: 0 }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipText,
            bodyColor: theme.tooltipText,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
          }
        }
      }
    });
  }

  // Fetch API & Render All 5 Charts
  async function renderDashboardCharts() {
    try {
      const token = localStorage.getItem('authToken') || localStorage.getItem('auth_token') || '';
      let res = await fetch('/api/analytics/dashboard', {
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });

      if (!res.ok) {
        res = await fetch('http://localhost:4000/api/analytics/dashboard', {
          headers: { Authorization: token ? `Bearer ${token}` : '' }
        });
      }

      if (!res.ok) {
        res = await fetch('/api/manager/analytics', {
          headers: { Authorization: token ? `Bearer ${token}` : '' }
        });
      }

      if (!res.ok) {
        res = await fetch('http://localhost:4000/api/manager/analytics', {
          headers: { Authorization: token ? `Bearer ${token}` : '' }
        });
      }

      if (!res.ok) throw new Error('Failed to fetch analytics data');

      const data = await res.json();
      console.log('[ZyroAnalytics] Fetched API Data:', data);
      lastData = data;

      const charts = data.charts || {};
      const kpis = data.kpis || {};

      // 1. Approval Trend Chart
      const trendCanvas = getCanvasElement(['zyro-chart-approval-trend', 'trendChart', 'approvalTrendChart', 'approval-chart']);
      if (trendCanvas) {
        initApprovalTrendChart(trendCanvas, charts.trend || []);
      }

      // 2. Status Distribution Doughnut Chart
      const statusCanvas = getCanvasElement(['zyro-chart-status-doughnut', 'statusDoughnutChart', 'statusChart', 'historyStatusChart']);
      if (statusCanvas) {
        initStatusDoughnutChart(statusCanvas, charts.statusDistribution || {}, kpis.approvalRate || 0);
      }

      // 3. Approval Speed Horizontal Bar Chart
      const speedCanvas = getCanvasElement(['zyro-chart-approval-speed', 'speedChart', 'approvalSpeedChart']);
      if (speedCanvas) {
        initApprovalSpeedChart(speedCanvas, charts.approvalSpeed || []);
      }

      // 4. Monthly Requests Gradient Bar Chart
      const monthlyCanvas = getCanvasElement(['zyro-chart-monthly-requests', 'monthlyChart', 'monthly-chart', 'monthly-chart-canvas']);
      if (monthlyCanvas) {
        initMonthlyRequestsChart(monthlyCanvas, charts.monthlyRequests || []);
      }

      // 5. Workflow Funnel Chart
      const funnelCanvas = getCanvasElement(['zyro-chart-workflow-funnel', 'funnelChart', 'workflowFunnelChart', 'department-chart']);
      if (funnelCanvas) {
        initWorkflowFunnelChart(funnelCanvas, charts.workflowFunnel || []);
      }

      // Update KPI Cards
      updateKPICards(kpis);

    } catch (err) {
      console.error('[ZyroAnalytics] Chart rendering error:', err);
    }
  }

  function updateKPICards(kpis) {
    if (!kpis) return;
    const pEl = document.getElementById('kpi-pending') || document.getElementById('pending-count');
    const aEl = document.getElementById('kpi-approved') || document.getElementById('approved-count');
    const rEl = document.getElementById('kpi-rejected') || document.getElementById('rejected-count');
    const eEl = document.getElementById('kpi-escalated') || document.getElementById('escalated-count');
    const rateEl = document.getElementById('kpi-approval-rate') || document.getElementById('approval-rate');
    const timeEl = document.getElementById('kpi-avg-time') || document.getElementById('avg-decision-time');

    if (pEl) pEl.innerText = String(kpis.pending ?? 0);
    if (aEl) aEl.innerText = String(kpis.approved ?? 0);
    if (rEl) rEl.innerText = String(kpis.rejected ?? 0);
    if (eEl) eEl.innerText = String(kpis.escalated ?? 0);
    if (rateEl) rateEl.innerText = `${kpis.approvalRate ?? 0}%`;
    if (timeEl) timeEl.innerText = `${kpis.avgDecisionTimeMins ?? 0} mins`;
  }

  // Theme Change Observer
  function observeThemeChanges() {
    const observer = new MutationObserver(() => {
      if (lastData) {
        const charts = lastData.charts || {};
        const kpis = lastData.kpis || {};
        const trendCanvas = getCanvasElement(['zyro-chart-approval-trend', 'trendChart', 'approvalTrendChart', 'approval-chart']);
        const statusCanvas = getCanvasElement(['zyro-chart-status-doughnut', 'statusDoughnutChart', 'statusChart', 'historyStatusChart']);
        const speedCanvas = getCanvasElement(['zyro-chart-approval-speed', 'speedChart', 'approvalSpeedChart']);
        const monthlyCanvas = getCanvasElement(['zyro-chart-monthly-requests', 'monthlyChart', 'monthly-chart', 'monthly-chart-canvas']);
        const funnelCanvas = getCanvasElement(['zyro-chart-workflow-funnel', 'funnelChart', 'workflowFunnelChart', 'department-chart']);

        if (trendCanvas) initApprovalTrendChart(trendCanvas, charts.trend);
        if (statusCanvas) initStatusDoughnutChart(statusCanvas, charts.statusDistribution, kpis.approvalRate);
        if (speedCanvas) initApprovalSpeedChart(speedCanvas, charts.approvalSpeed);
        if (monthlyCanvas) initMonthlyRequestsChart(monthlyCanvas, charts.monthlyRequests);
        if (funnelCanvas) initWorkflowFunnelChart(funnelCanvas, charts.workflowFunnel);
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  // Listeners & Init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      renderDashboardCharts();
      observeThemeChanges();
    });
  } else {
    renderDashboardCharts();
    observeThemeChanges();
  }

  window.addEventListener('zyro-dashboard-refresh', () => {
    renderDashboardCharts();
  });

  return {
    renderDashboardCharts,
    refreshCharts: renderDashboardCharts
  };
})();

window.ZyroAnalytics = ZyroAnalytics;
