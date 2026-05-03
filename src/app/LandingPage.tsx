import './landing.css';

const demoPath = '/demo';

const proofMetrics = [
  { label: 'Aha moment', value: '< 2 min', detail: 'Pedidos, capacidad, Gantt y explicación en una sola demo.' },
  { label: 'Datos seguros', value: 'Local', detail: 'La demo pública no sube órdenes ni recetas a una API de solver.' },
  { label: 'Foco MVP', value: 'Excel → plan', detail: 'Wedge claro para validar con planners antes de ampliar constraints.' },
];

const painPoints = [
  'El Excel dice que el plan cabe, pero planta termina apagando fuegos.',
  'Nadie ve rápido qué pedido se retrasa ni qué recurso bloquea.',
  'Comparar escenarios depende de macros, intuición y conocimiento tribal.',
];

const steps = [
  { title: 'Carga pedidos', text: 'Parte de una planta demo y edita cantidades, due dates y prioridades.' },
  { title: 'Planifica localmente', text: 'Genera un schedule demo sin exponer la API CP-SAT pública.' },
  { title: 'Explica el cuello de botella', text: 'KPIs, Gantt y “qué ha pasado” para decidir el siguiente cambio.' },
];

const features = [
  {
    title: 'Factibilidad antes que promesas',
    text: 'ForgePlan no intenta vender “optimización total” desde el día uno: responde si el plan cabe y dónde rompe.',
  },
  {
    title: 'Pensado para planners industriales',
    text: 'Lenguaje de pedidos, recursos, retrasos y siguientes acciones; no una demo técnica de solver para ingenieros.',
  },
  {
    title: 'Local-first por diseño',
    text: 'La arquitectura permite probar con datos sensibles sin convertir la privacidad industrial en una objeción comercial.',
  },
  {
    title: 'Preparado para Excel/CSV',
    text: 'La siguiente señal de producto es importar pedidos reales, no añadir otra capa industrial sin entrevistas.',
  },
];

export default function LandingPage() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="ForgePlan navigation">
        <a className="landing-brand" href="/" aria-label="ForgePlan home">
          <span className="brand-mark">FP</span>
          <span>ForgePlan</span>
        </a>
        <div className="landing-nav-links">
          <a href="#problema">Problema</a>
          <a href="#producto">Producto</a>
          <a href="#demo">Demo</a>
          <a className="nav-cta" href={demoPath}>Abrir demo</a>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="hero-copy">
          <p className="landing-eyebrow"><span /> Planificación industrial local-first</p>
          <h1>Comprueba si tu plan de producción cabe antes de que se rompa en planta.</h1>
          <p className="hero-subtitle">
            ForgePlan convierte pedidos, recursos y tiempos en una demo visual de factibilidad: qué pedido llega tarde,
            qué recurso bloquea y qué cambio probar. Sin prometer un APS completo antes de validar el dolor real.
          </p>
          <div className="hero-actions">
            <a className="primary-cta" href={demoPath}>Ver demo interactiva</a>
            <a className="secondary-cta" href="#producto">Cómo funciona</a>
          </div>
          <div className="hero-note">
            Demo pública con solver mock en navegador. CP-SAT real queda para ejecución local/trusted.
          </div>
        </div>

        <div className="hero-console" aria-label="ForgePlan product preview">
          <div className="console-topbar">
            <span />
            <span />
            <span />
            <strong>planner_run_042</strong>
          </div>
          <div className="console-grid">
            <div className="schedule-panel wide">
              <div className="panel-label">Resultado</div>
              <h2>Plan viable con 1 pedido en riesgo</h2>
              <div className="kpi-row">
                <span><strong>420</strong> makespan</span>
                <span><strong>1</strong> tarde</span>
                <span><strong>LD-01</strong> cuello</span>
              </div>
            </div>
            <div className="schedule-panel">
              <div className="panel-label">Pedido</div>
              <p>order_3 termina 38 min tarde si no liberas línea.</p>
            </div>
            <div className="schedule-panel">
              <div className="panel-label">Siguiente acción</div>
              <p>Reduce setup o mueve due date antes de añadir otra máquina.</p>
            </div>
            <div className="gantt-preview wide">
              <div className="lane"><span>Dosificación</span><i style={{ width: '72%' }} /></div>
              <div className="lane"><span>Granulado</span><i style={{ width: '58%' }} /></div>
              <div className="lane"><span>Expedición</span><i style={{ width: '36%' }} /></div>
            </div>
          </div>
        </div>
      </section>

      <section className="proof-strip" aria-label="ForgePlan proof points">
        {proofMetrics.map((metric) => (
          <article key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <p>{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="landing-section split" id="problema">
        <div>
          <p className="landing-eyebrow"><span /> Problema</p>
          <h2>El competidor inicial no es SAP. Es el Excel que nadie se atreve a tocar.</h2>
        </div>
        <div className="pain-list">
          {painPoints.map((point) => <p key={point}>{point}</p>)}
        </div>
      </section>

      <section className="landing-section" id="producto">
        <div className="section-heading">
          <p className="landing-eyebrow"><span /> Producto</p>
          <h2>Un loop de planificación que un planner puede entender en una llamada.</h2>
        </div>
        <div className="steps-grid">
          {steps.map((step, index) => (
            <article className="step-card" key={step.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section feature-grid" aria-label="ForgePlan features">
        {features.map((feature) => (
          <article className="feature-card" key={feature.title}>
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
          </article>
        ))}
      </section>

      <section className="demo-cta" id="demo">
        <p className="landing-eyebrow"><span /> Demo pública</p>
        <h2>Prueba el flujo antes de hablar de integraciones.</h2>
        <p>
          La landing apunta a una demo segura: editor visual, pedidos, botón “Planificar pedidos”, KPIs, Gantt y explicación.
          La validación comercial sigue siendo prioritaria antes de ampliar el solver.
        </p>
        <a className="primary-cta" href={demoPath}>Abrir ForgePlan demo</a>
      </section>
    </main>
  );
}
