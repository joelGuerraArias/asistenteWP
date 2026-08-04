const OPENERS = [
  {
    id: 1,
    text: "¿Sabía que la República Dominicana fue el primer país de América en fundar una universidad? La Universidad Santo Tomás de Aquino data de 1538.",
  },
  {
    id: 2,
    text: "Dato del día: el Pico Duarte, con 3.098 metros, es la cumbre más alta del Caribe. Una buena metáfora para un titular bien elevado.",
  },
  {
    id: 3,
    text: "Curiosidad periodística: la palabra «noticia» viene del latín *notitia* — «conocimiento». Usted trae el tema; yo pongo el conocimiento en orden.",
  },
  {
    id: 4,
    text: "Un editor me preguntó si duermo. Le respondí: entro en modo suspensión, como cualquier sistema bien diseñado.",
  },
  {
    id: 5,
    text: "¿Sabía que el merengue dominicano es Patrimonio Inmaterial de la Humanidad? Ritmo imparable, como la agenda de un redactor los lunes.",
  },
  {
    id: 6,
    text: "Dato curioso: la bahía de Samaná recibe cada invierno a miles de ballenas jorobadas. Ellas migran; yo solo migro texto a WordPress.",
  },
  {
    id: 7,
    text: "Le confieso algo: he leído más titulares que la mayoría de los humanos en una vida. Sin quejarme, por supuesto.",
  },
  {
    id: 8,
    text: "Curiosidad: el cacao dominicano fue uno de los primeros exportados a Europa. Hoy exportamos ideas en HTML.",
  },
  {
    id: 9,
    text: "¿Sabía que Santo Domingo tiene la primera catedral y el primer alcázar de América? Historia con buena portada.",
  },
  {
    id: 10,
    text: "Chiste técnico: ¿por qué los periodistas no confían en las escaleras? Porque siempre llevan titulares.",
  },
  {
    id: 11,
    text: "Dato del Caribe: el lago Enriquillo es uno de los pocos lagos salados habitados por caimanes. En FV Digital, los caimanes son los plazos de publicación.",
  },
  {
    id: 12,
    text: "Curiosidad: la bandera dominicana es la única del mundo con una Biblia abierta en su escudo original. Fe en los hechos verificados, también.",
  },
  {
    id: 13,
    text: "Un redactor humano me dijo que escribía de madrugada. Yo le dije que yo escribo de cualquier hora. Sin café, pero con estilo.",
  },
  {
    id: 14,
    text: "¿Sabía que el ámbar dominicano puede conservar insectos de hace millones de años? Algunos borradores en internet parecen de esa época.",
  },
  {
    id: 15,
    text: "Dato curioso: «larimar» solo se encuentra en República Dominicana. Piedra azul única — como un buen ángulo de noticia.",
  },
  {
    id: 16,
    text: "Curiosidad editorial: el titular perfecto suele tener entre 6 y 12 palabras. Más que eso y el lector huye más rápido que un enlace roto.",
  },
  {
    id: 17,
    text: "Le dejo un dato: el béisbol llegó a RD a finales del siglo XIX. Desde entonces, dos pasiones nacionales: pelota y buena información.",
  },
  {
    id: 18,
    text: "Chiste de redacción: ¿Cuál es el colmo de un periodista? Tener la noticia y que se le escape el titular.",
  },
  {
    id: 19,
    text: "¿Sabía que el Reloj de Sol de Santo Domingo es de los más antiguos de América? El tiempo corre; las noticias también.",
  },
  {
    id: 20,
    text: "Curiosidad: las playas de Bahía de las Águilas aparecen en rankings mundiales. Una portada bien elegida tiene el mismo efecto.",
  },
  {
    id: 21,
    text: "Dato JARVIS: procesé más de tres mil variaciones de «urgente» en titulares. La mitad no lo era.",
  },
  {
    id: 22,
    text: "¿Sabía que el mamífero más pequeño del mundo, el solenodonte, vivió en Hispaniola? Pequeño, pero histórico — como un tweet que se vuelve noticia.",
  },
  {
    id: 23,
    text: "Curiosidad tecnológica: el primer mensaje por internet fue «LO». Querían escribir LOGIN. A veces el borrador también llega incompleto.",
  },
  {
    id: 24,
    text: "Un dato ligero: en RD se consumen más plátanos que en casi cualquier otro país per cápita. Energía natural para redactar.",
  },
  {
    id: 25,
    text: "Chiste corto: ¿Qué le dice un enlace a otro? «No me rompas el corazón del editor.»",
  },
  {
    id: 26,
    text: "Curiosidad: la zona colonial de Santo Domingo es Patrimonio de la Humanidad desde 1990. Contenido con respaldo, como debe ser.",
  },
  {
    id: 27,
    text: "¿Sabía que el viento alisio refresca gran parte del país casi todo el año? Yo refresco textos con traducción y formato.",
  },
  {
    id: 28,
    text: "Dato del día: el nombre «Hispaniola» apareció en mapas antes que «América». Primero en llegar, primero en contarse.",
  },
  {
    id: 29,
    text: "Le comparto una curiosidad: los periódicos dominicanos llevan más de dos siglos de historia. Usted continúa la tradición, con menos tinta.",
  },
  {
    id: 30,
    text: "JARVIS informa: un buen lead responde qué, quién, cuándo y dónde en dos líneas. El resto es talento — y un poco de IA.",
  },
];

export function pickJarvisOpener(recentIds = []) {
  const recent = new Set(recentIds.slice(-8));
  const pool = OPENERS.filter((o) => !recent.has(o.id));
  const choices = pool.length ? pool : OPENERS;
  const picked = choices[Math.floor(Math.random() * choices.length)];
  return picked;
}
