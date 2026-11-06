/* Annual management model; prices and operating inputs remain explicit scenarios. */
function calculateCosts(v, mode) {
  const qLoad = 20 * v['plan-mpci'] / v['base-mpci'] * v['base-handle'] / v['plan-handle'];
  const q = Math.min(v.coverage, qLoad);
  const labor = [20, q].map((ratio, i) => {
    const period = i ? 'plan' : 'base';
    return 12 * v[period + '-salary'] * v[period + '-shifts'] / ratio;
  });
  const kit = [v['base-domain'] + v['base-kit'], v.quote + v['plan-kit']];
  const bom = [v['base-bom'] + kit[0], v['plan-bom'] + kit[1]];
  const power = [v['base-power'], v.power].map(w => w / 1000 * v['powered-hours'] * v['electricity-price']);
  const factor = mode === 'customer' ? v['purchase-factor'] : 1;
  const residual = v.residual / 100;
  const annualize = cost => cost * factor * ((1 - residual) / v['vehicle-years'] + (1 + residual) / 2 * v.finance / 100);
  const annotation = period => ['3d', '2d', 'barrier', 'dct'].reduce((total, key) => total + (v[key + '-' + period] === 0 ? 0 : v[key + '-' + period] * v[key + '-price']), 0);
  const initial = annotation('initial') + v['initial-training'] + v['initial-extra'] + v.nre;
  const recurring = annotation('annual') + v['annual-training'] + v['annual-extra'];
  const rd = [v['base-rd-budget'] / v['benefit-vehicles'], (initial / v['rd-years'] + recurring) / v['benefit-vehicles']];
  const rows = {
    vehicle: bom.map(annualize),
    software: ['base', 'plan'].map(p => v[p + (mode === 'customer' ? '-subscription' : '-cloud')]),
    assistance: labor.map((cost, i) => cost + v[(i ? 'plan' : 'base') + '-rescue']),
    energy: power.map((cost, i) => cost + v[(i ? 'plan' : 'base') + '-traction']),
    maintenance: [v['base-maintenance'], v['plan-maintenance']],
    insurance: ['base', 'plan'].map(p => v[p + '-premium'] + v[p + '-loss']),
    operations: [v['base-operations'], v['plan-operations']],
    rd: mode === 'resource' ? rd : [0, 0]
  };
  const totals = [0, 1].map(i => Object.values(rows).reduce((total, pair) => total + pair[i], 0));
  const adCost = annualize(kit[0]) + rows.software[0] + rows.assistance[0] + rows.rd[0] + power[0];
  return { qLoad, q, labor, kit, bom, power, initial, recurring, rd, rows, totals, adCost };
}

function calculateTco(values) {
  const { baseCost, planCost, baseOutput, planOutput, competitorCost, competitorOutput, adCost } = values;
  if (![baseCost, planCost, baseOutput, planOutput].every(n => Number.isFinite(n) && n > 0)) {
    throw new RangeError('年度费用与有效载货公里必须为大于0的有限数值。');
  }
  const baseUnit = baseCost / baseOutput;
  const planUnit = planCost / planOutput;
  const competitorUnit = competitorCost > 0 && competitorOutput > 0 ? competitorCost / competitorOutput : NaN;
  const advantage = (1 - planUnit / competitorUnit) * 100;
  const gap = Math.max(0, planUnit - competitorUnit * 0.6);
  const costIndex = planCost / baseCost * 100;
  const unitIndex = planUnit / baseUnit * 100;
  const adShare = adCost / baseCost * 100;
  if (![baseUnit, planUnit, costIndex, unitIndex, adShare].every(Number.isFinite)) {
    throw new RangeError('参数超出可计算范围，请填写合理的单车年度数值。');
  }
  return { baseCost, planCost, baseUnit, planUnit, competitorUnit, advantage, gap, costIndex, unitIndex, adShare };
}

(() => {
  const form = document.getElementById('tco-form');
  const forms = Array.from(document.querySelectorAll('form[data-linked]'));
  const mode = document.getElementById('account-mode');
  const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
  const error = document.getElementById('input-error');
  const verdict = document.getElementById('model-verdict');
  const chart = document.getElementById('waterfall');
  const sensitivityBody = document.getElementById('sensitivity-body');
  const element = id => document.getElementById(id);
  const setText = (id, text) => { element(id).textContent = text; };
  const money = value => numberFormat.format(value);
  function read(id) {
    const input = element(id);
    const valid = input.validity.valid && Number.isFinite(input.valueAsNumber);
    input.setAttribute('aria-invalid', String(!valid));
    if (!valid) throw new RangeError('请补齐或修正：' + (input.closest('label')?.textContent || input.getAttribute('aria-label') || id) + '。');
    return input.valueAsNumber;
  }
  function svgElement(name, attrs, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs).forEach(function (entry) { element.setAttribute(entry[0], String(entry[1])); });
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function drawWaterfall(result) {
    chart.replaceChildren();
    const svg = svgElement('svg', { viewBox: '0 0 400 230', 'aria-hidden': 'true', focusable: 'false' });
    const max = Math.max(100, result.costIndex, result.unitIndex) * 1.22;
    const y = function (value) { return 174 - value / max * 146; };
    const steps = [
      { label: '现状单位成本', from: 0, to: 100, value: 100, total: true },
      { label: '年度费用变化', from: 100, to: result.costIndex, value: result.costIndex - 100 },
      { label: '有效产出换算', from: result.costIndex, to: result.unitIndex, value: result.unitIndex - result.costIndex },
      { label: '方案单位成本', from: 0, to: result.unitIndex, value: result.unitIndex, total: true }
    ];
    [0, 0.5, 1].forEach(function (fraction) {
      const value = max * fraction;
      svg.append(svgElement('line', { x1: 22, x2: 382, y1: y(value), y2: y(value), stroke: '#e3eae9', 'stroke-width': 1, 'stroke-dasharray': fraction ? '3 4' : '0' }));
    });
    steps.forEach(function (step, index) {
      const x = 27 + index * 94;
      const top = y(Math.max(step.from, step.to));
      const height = Math.max(Math.abs(y(step.from) - y(step.to)), 1);
      const color = step.total ? (index === 0 ? '#a6b9c1' : '#07836e') : (step.value <= 0 ? '#78b69b' : '#d9a56d');
      svg.append(svgElement('rect', { x: x, y: top, width: 56, height: height, rx: 3, fill: color }));
      if (index < 3) svg.append(svgElement('line', { x1: x + 56, x2: x + 94, y1: y(step.to), y2: y(step.to), stroke: '#9cb2b6', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
      const displayValue = (step.total || step.value <= 0 ? '' : '+') + step.value.toFixed(1);
      svg.append(svgElement('text', { x: x + 28, y: top - 9, 'text-anchor': 'middle', fill: '#29475a', 'font-size': 12, 'font-family': 'Arial, sans-serif' }, displayValue));
      svg.append(svgElement('text', { x: x + 28, y: 199, 'text-anchor': 'middle', fill: '#6c818d', 'font-size': 9, 'font-family': 'sans-serif' }, step.label));
    });
    chart.append(svg);
    chart.setAttribute('aria-label', '现状单位成本指数100；年度费用变化后为' + result.costIndex.toFixed(1) + '；有效产出换算后，方案单位成本指数为' + result.unitIndex.toFixed(1) + '。');
  }

  function drawSensitivity(result) {
    sensitivityBody.replaceChildren();
    [0, 10, 20].forEach(function (reduction) {
      const advantage = (1 - result.planUnit / (result.competitorUnit * (1 - reduction / 100))) * 100;
      const pass = advantage >= 40 - 1e-9;
      const tr = document.createElement('tr');
      [reduction + '%', advantage.toFixed(1) + '%', pass ? '情景达标' : '尚有差距'].forEach(function (value, index) {
        const td = document.createElement('td');
        td.textContent = value;
        if (index === 2) td.className = pass ? 'pass-text' : 'below-text';
        tr.append(td);
      });
      sensitivityBody.append(tr);
    });
  }

  function clearResults(message) {
    error.textContent = message;
    error.hidden = false;
    ['base-total', 'plan-total', 'ad-share', 'unit-cost', 'cost-advantage', 'target-gap', 'staff-base', 'staff-plan', 'staff-change', 'bom-total', 'kit-total', 'power-total', 'rd-initial', 'rd-annual', 'rd-unit'].forEach(id => setText(id, '—'));
    form.querySelectorAll('input[readonly]').forEach(input => { input.value = ''; });
    ['staffing-status', 'hardware-status', 'rd-status'].forEach(id => setText(id, '源参数未完整或无效，暂停联动；请修正下方整车账提示的字段。'));
    chart.replaceChildren();
    chart.setAttribute('aria-label', '参数未完整或无效，暂停显示图表。');
    sensitivityBody.replaceChildren();
    verdict.textContent = '未完成成本核算；缺失报价不会作为零成本，也不会产生排名。';
    verdict.classList.add('below');
  }

  function update() {
    const customer = mode.value === 'customer';
    setText('account-note', customer ? '客户账：BOM乘采购系数估算购置价；服务收费已覆盖的研发不再计入。真实售价与合同待校准。' : '自营资源账：出厂成本年化＋实际云资源＋研发管理分摊；不含对外订阅收费，也不是完整公司利润表。');
    const choice = document.querySelector('input[name="hardware-choice"]:checked');
    const selected = choice.value;
    const v = {};
    let rdError = '';
    try {
      forms.forEach(linkedForm => {
        if (linkedForm.id === 'rd-form') return;
        linkedForm.querySelectorAll('input[type="number"]:not([readonly])').forEach(input => {
          const id = input.id;
          if (id.startsWith('competitor-') || /^(demo|j6p|dual6m|j6m)-/.test(id)) return;
          if ((!customer && (id.endsWith('-subscription') || id === 'purchase-factor')) || (customer && id.endsWith('-cloud'))) return;
          v[id] = read(id);
        });
      });
      v.quote = read(selected + '-quote');
      v.power = read(selected + '-power');
      try {
        v.nre = read(selected + '-nre');
        element('rd-form').querySelectorAll('input').forEach(input => {
          if (!input.id.endsWith('-price')) v[input.id] = read(input.id);
        });
        ['3d', '2d', 'barrier', 'dct'].forEach(key => {
          const needed = v[key + '-initial'] > 0 || v[key + '-annual'] > 0;
          v[key + '-price'] = needed ? read(key + '-price') : 0;
          if (!needed) element(key + '-price').removeAttribute('aria-invalid');
        });
      } catch (rdFailure) { rdError = rdFailure.message; }
      const costs = calculateCosts(v, mode.value);
      if (![costs.initial, costs.recurring, ...costs.rd].every(Number.isFinite)) rdError ||= '研发预算参数不完整或超出可计算范围。';
      if (rdError && !customer) throw new RangeError('自营资源账需要完整研发归集。' + rdError);
      const result = calculateTco({ baseCost: costs.totals[0], planCost: costs.totals[1], baseOutput: v['base-output'], planOutput: v['plan-output'], adCost: costs.adCost });
      error.hidden = true;
      Object.entries(costs.rows).forEach(([key, pair]) => pair.forEach((amount, i) => { element((i ? 'plan' : 'base') + '-' + key).value = amount.toFixed(2); }));
      setText('base-total', money(result.baseCost));
      setText('plan-total', money(result.planCost));
      setText('ad-share', result.adShare.toFixed(1) + '%');
      setText('unit-cost', result.baseUnit.toFixed(3) + ' → ' + result.planUnit.toFixed(3));
      setText('staff-base', money(costs.labor[0] / 12));
      setText('staff-plan', money(costs.labor[1] / 12));
      setText('staff-change', money(costs.labor[1] - costs.labor[0]));
      setText('staffing-status', '负荷等效上限约1:' + money(costs.qLoad) + '，本情景取1:' + money(costs.q) + '；年人工费 ' + money(costs.labor[0]) + ' → ' + money(costs.labor[1]) + ' 元，叠加救援后已回填整车账。候选容量仍需峰值与响应时效验证，实际席位人数向上取整并留冗余。');
      ['bom', 'kit', 'power'].forEach(key => setText(key + '-total', costs[key].map(money).join(' → ')));
      setText('hardware-status', '已选择：' + choice.closest('label').textContent.trim() + '。当前' + (customer ? '客户账' : '自营资源账') + '为 ' + result.planUnit.toFixed(3) + ' 元/有效km。报价和功耗已联动硬件与电费，NRE归研发预算。' + (selected === 'demo' ? '本行仅为算式演示，不代表任何国产平台报价。' : '录入数据仅用于经济性预评估；安全、可靠性、时延、质量及量产条件仍待项目验证。'));
      if (rdError) {
        ['rd-initial', 'rd-annual', 'rd-unit'].forEach(id => setText(id, '待补齐'));
        setText('rd-status', rdError + ' 客户账仍按订阅收费计算；研发内部账尚未完整，不据此声称企业净收益。');
      } else {
        setText('rd-initial', money(costs.initial));
        setText('rd-annual', money(costs.recurring));
        setText('rd-unit', money(costs.rd[1]));
        setText('rd-status', '首年预算支出 ' + money(costs.initial + costs.recurring) + ' 元，后续年度 ' + money(costs.recurring) + ' 元；同车群单车年分摊 ' + costs.rd.map(money).join(' → ') + ' 元。' + (customer ? '客户账研发行记0，订阅内不重复加收；企业分摊仍单独展示。' : '已回填整车账研发行，并以实际云资源替代订阅收费。'));
      }
      drawWaterfall(result);
      sensitivityBody.replaceChildren();
      setText('cost-advantage', '待验证');
      setText('target-gap', '待验证');
      verdict.classList.add('below');
      verdict.textContent = '本方成本已联动；竞品口径与数据待验证，暂不判断40%优势。默认值及填写值均为情景，硬件与人车比仍需准入。';
      const competitorEntered = element('competitor-cost').value !== '' || element('competitor-output').value !== '';
      if (!competitorEntered) ['competitor-cost', 'competitor-output'].forEach(id => element(id).removeAttribute('aria-invalid'));
      if (competitorEntered) {
        try {
          const comparison = calculateTco({ ...result, baseOutput: v['base-output'], planOutput: v['plan-output'], adCost: costs.adCost, competitorCost: read('competitor-cost'), competitorOutput: read('competitor-output') });
          if (![comparison.advantage, comparison.gap, comparison.competitorUnit].every(Number.isFinite)) throw new RangeError('竞品参数超出可计算范围。');
          setText('cost-advantage', comparison.advantage.toFixed(1) + '%');
          setText('target-gap', comparison.gap.toFixed(3) + ' 元/有效km');
          const passes = comparison.advantage >= 40 - 1e-9;
          verdict.textContent = (passes ? '经济测算达到40%门槛。' : '经济测算尚未达到40%门槛。') + '此为录入数据下的情景结果；同场景可比性、安全和量产验证未完成前，不构成真实领先结论。';
          drawSensitivity(comparison);
        } catch (comparisonError) { verdict.textContent = comparisonError.message + ' 本方成本仍有效，竞品比较暂停。'; }
      }
    } catch (calculationError) { clearResults(calculationError.message); }
  }

  forms.forEach(linkedForm => {
    linkedForm.addEventListener('input', update);
    linkedForm.addEventListener('submit', event => { event.preventDefault(); update(); });
  });
  mode.addEventListener('change', () => {
    ['competitor-cost', 'competitor-output'].forEach(id => { element(id).value = ''; element(id).removeAttribute('aria-invalid'); });
    update();
  });
  document.querySelectorAll('input[name="hardware-choice"]').forEach(input => input.addEventListener('change', () => {
    document.querySelectorAll('.hardware-quotes input[type="number"]').forEach(field => field.removeAttribute('aria-invalid'));
    update();
  }));
  element('reset-linked').addEventListener('click', () => {
    forms.forEach(linkedForm => linkedForm.reset());
    document.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
    update();
  });
  update();

  document.querySelectorAll('[data-cost-source]').forEach(link => {
    link.addEventListener('click', () => {
      let target = document.getElementById(link.hash.slice(1));
      while (target) {
        if (target.tagName === 'DETAILS') target.open = true;
        target = target.parentElement;
      }
    });
  });

  const phaseButtons = Array.from(document.querySelectorAll('[data-phase]'));
  phaseButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      phaseButtons.forEach(function (other) {
        const selected = other === button;
        other.classList.toggle('selected', selected);
        other.setAttribute('aria-pressed', String(selected));
        document.getElementById(other.dataset.phase).classList.toggle('selected', selected);
      });
    });
  });

  const roles = Array.from(document.querySelectorAll('.role'));
  const rolesToggle = document.getElementById('roles-toggle');
  function updateRoleButton() {
    const allOpen = roles.every(function (role) { return role.open; });
    rolesToggle.textContent = allOpen ? '收起全部职责' : '展开全部职责';
    rolesToggle.setAttribute('aria-expanded', String(allOpen));
  }
  rolesToggle.addEventListener('click', function () {
    const open = !roles.every(function (role) { return role.open; });
    roles.forEach(function (role) { role.open = open; });
    updateRoleButton();
  });
  roles.forEach(function (role) { role.addEventListener('toggle', updateRoleButton); });

  const sections = Array.from(document.querySelectorAll('main > section'));
  const links = Array.from(document.querySelectorAll('.sidebar nav a'));
  const progress = document.getElementById('reading-progress');
  let scrollQueued = false;
  function updateReading() {
    const position = window.scrollY;
    let current = sections[0].id;
    sections.forEach(function (section) { if (section.getBoundingClientRect().top <= 150) current = section.id; });
    links.forEach(function (link) {
      const active = link.hash === '#' + current;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    });
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (distance > 0 ? Math.min(100, Math.max(0, position / distance * 100)) : 100) + '%';
    scrollQueued = false;
  }
  window.addEventListener('scroll', function () { if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(updateReading); } }, { passive: true });
  window.addEventListener('resize', updateReading);

  let printDetails = null;
  window.addEventListener('beforeprint', function () {
    if (printDetails) return;
    printDetails = Array.from(document.querySelectorAll('details')).map(function (detail) { return { detail: detail, open: detail.open }; });
    printDetails.forEach(function (entry) { entry.detail.open = true; });
  });
  window.addEventListener('afterprint', function () {
    if (printDetails) printDetails.forEach(function (entry) { entry.detail.open = entry.open; });
    printDetails = null;
    updateRoleButton();
    updateReading();
  });
  document.getElementById('print-button').addEventListener('click', function () { window.print(); });
  document.documentElement.classList.add('js');
  updateReading();
})();
