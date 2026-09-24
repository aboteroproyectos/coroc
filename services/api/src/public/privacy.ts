import type { Lang } from '../common/i18n.js';

/**
 * Política de privacidad pública de COROC (§20.1, §20.4; ADR-058). La exigen Google Play y App Store y es la misma para
 * la app y el portal del deudor. Está escrita para personas: qué datos, para qué, quién los ve, cuánto tiempo y cómo
 * ejercer los derechos. Las etiquetas de privacidad de las tiendas (docs/tiendas) se derivan de este texto.
 */
export const PRIVACY_VERSION = '2026-09-23';

type Section = { h: string; p: string[] };
type Policy = { title: string; updated: string; intro: string; sections: Section[] };

export function privacyPolicy(lang: Lang, contact: string): Policy {
  return lang === 'en' ? en(contact) : lang === 'pt-BR' ? pt(contact) : es(contact);
}

const es = (contact: string): Policy => ({
  title: 'Política de privacidad',
  updated: `Vigente desde el ${PRIVACY_VERSION}`,
  intro:
    'COROC es una herramienta de gestión de cartera para prestamistas: les ayuda a llevar sus clientes, préstamos, pagos y recibos. COROC no ofrece ni otorga préstamos. Esta política explica cómo se tratan los datos personales en la app y en el portal del deudor.',
  sections: [
    { h: 'Quién es responsable', p: [
      'Cada empresa que usa COROC es la responsable de los datos de sus clientes (deudores) y decide para qué los usa. COROC actúa como encargado: los trata solo por cuenta de la empresa y según sus instrucciones.',
      'COROC es responsable de los datos de las cuentas de usuario (nombre, usuario, correo y datos de seguridad) que necesita para prestar el servicio.',
    ] },
    { h: 'Qué datos se tratan', p: [
      'De los deudores: nombre, documento de identidad, teléfonos, correo, dirección, préstamos, pagos, recibos, comprobantes de pago que envían y los mensajes que se les envían, con su consentimiento por canal.',
      'De los usuarios de la app: nombre, usuario, correo, rol, idioma, sesiones y dispositivos, y el registro de sus acciones (bitácora).',
      'La app no pide acceso a contactos, SMS, ubicación, cámara en segundo plano ni al almacenamiento completo del teléfono. Los archivos solo se leen cuando la persona los elige o los comparte con COROC.',
      'No se usan los datos para publicidad, no se venden y no se rastrea a nadie entre apps o sitios.',
    ] },
    { h: 'Para qué se usan', p: [
      'Llevar la cartera, registrar pagos, generar recibos y estados de cuenta, leer los comprobantes de pago que envía el deudor, enviar los mensajes que la empresa configure dentro de las reglas de contacto de la ley, y proteger las cuentas (segundo factor, bloqueo por intentos y bitácora).',
    ] },
    { h: 'Con quién se comparten', p: [
      'Solo con proveedores que prestan el servicio, bajo acuerdos de tratamiento de datos: alojamiento y almacenamiento cifrado, envío de correo, WhatsApp Business (Meta) cuando la empresa lo activa y, si la empresa lo habilita, un servicio de inteligencia artificial que lee comprobantes de pago sin conservar los datos. Nunca se comparten con otras empresas que usen COROC: cada empresa está aislada de las demás.',
    ] },
    { h: 'Seguridad', p: [
      'Conexiones cifradas (TLS), documentos cifrados en reposo, enlaces de descarga firmados que vencen, contraseñas con Argon2id, segundo factor obligatorio para el Propietario y aislamiento entre empresas en la base de datos. Sin conexión, la app guarda en el equipo solo lo necesario para consultar, cifrado con una clave del almacén seguro del sistema, y lo borra al cerrar la sesión.',
    ] },
    { h: 'Cuánto tiempo se conservan', p: [
      'Mientras la empresa use COROC. Los movimientos contables y los recibos se conservan el tiempo que exige la ley comercial y tributaria del país de la empresa.',
      'Cuando una empresa se cierra, sus datos personales se eliminan pasados 30 días de gracia, salvo lo que la ley obliga a guardar.',
    ] },
    { h: 'Sus derechos', p: [
      'Deudores: pueden conocer, actualizar, rectificar y pedir la supresión de sus datos, y revocar el consentimiento para recibir mensajes (respondiendo SALIR, desde el portal o con el enlace del correo). La solicitud se dirige a la empresa con la que tienen el préstamo; COROC la ayuda a atenderla.',
      'Usuarios de la app: pueden eliminar su cuenta desde Configuración › Eliminar mi cuenta. El Propietario elimina la cuenta cerrando la empresa.',
      `Colombia: Ley 1581 de 2012 y sus decretos. Brasil: LGPD (Lei 13.709/2018). Para cualquier consulta sobre privacidad: ${contact}.`,
    ] },
    { h: 'Menores de edad', p: ['COROC es para empresas y sus clientes adultos. No está dirigido a menores de edad.'] },
    { h: 'Cambios', p: ['Si esta política cambia, se publicará aquí con su fecha y se avisará en la app.'] },
  ],
});

const pt = (contact: string): Policy => ({
  title: 'Política de privacidade',
  updated: `Em vigor desde ${PRIVACY_VERSION}`,
  intro:
    'O COROC é uma ferramenta de gestão de carteira para credores: ajuda a controlar clientes, empréstimos, pagamentos e recibos. O COROC não oferece nem concede empréstimos. Esta política explica como os dados pessoais são tratados no app e no portal do devedor.',
  sections: [
    { h: 'Quem é o controlador', p: [
      'Cada empresa que usa o COROC é a controladora dos dados dos seus clientes (devedores) e decide para que os usa. O COROC atua como operador: trata os dados apenas em nome da empresa e conforme as suas instruções.',
      'O COROC é o controlador dos dados das contas de usuário (nome, usuário, e-mail e dados de segurança) necessários para prestar o serviço.',
    ] },
    { h: 'Quais dados são tratados', p: [
      'Dos devedores: nome, documento de identidade, telefones, e-mail, endereço, empréstimos, pagamentos, recibos, comprovantes de pagamento que enviam e as mensagens enviadas a eles, com consentimento por canal.',
      'Dos usuários do app: nome, usuário, e-mail, função, idioma, sessões e dispositivos, e o registro das suas ações (auditoria).',
      'O app não pede acesso a contatos, SMS, localização, câmera em segundo plano nem ao armazenamento completo do telefone. Os arquivos só são lidos quando a pessoa os escolhe ou os compartilha com o COROC.',
      'Os dados não são usados para publicidade, não são vendidos e ninguém é rastreado entre apps ou sites.',
    ] },
    { h: 'Para que são usados', p: [
      'Controlar a carteira, registrar pagamentos, gerar recibos e extratos, ler os comprovantes enviados pelo devedor, enviar as mensagens configuradas pela empresa dentro das regras de contato da lei e proteger as contas (segundo fator, bloqueio por tentativas e auditoria).',
    ] },
    { h: 'Com quem são compartilhados', p: [
      'Apenas com fornecedores que prestam o serviço, sob acordos de tratamento de dados: hospedagem e armazenamento criptografado, envio de e-mail, WhatsApp Business (Meta) quando a empresa ativa e, se a empresa habilitar, um serviço de inteligência artificial que lê comprovantes sem guardar os dados. Nunca são compartilhados com outras empresas que usam o COROC: cada empresa é isolada das demais.',
    ] },
    { h: 'Segurança', p: [
      'Conexões criptografadas (TLS), documentos criptografados em repouso, links de download assinados que expiram, senhas com Argon2id, segundo fator obrigatório para o Proprietário e isolamento entre empresas no banco de dados. Sem conexão, o app guarda no aparelho apenas o necessário para consulta, criptografado com uma chave do armazenamento seguro do sistema, e apaga ao sair.',
    ] },
    { h: 'Por quanto tempo são guardados', p: [
      'Enquanto a empresa usar o COROC. Lançamentos contábeis e recibos são guardados pelo prazo exigido pela lei comercial e tributária do país da empresa.',
      'Quando uma empresa é encerrada, os dados pessoais são excluídos após 30 dias de carência, exceto o que a lei obriga a guardar.',
    ] },
    { h: 'Seus direitos', p: [
      'Devedores: podem acessar, corrigir e pedir a exclusão dos seus dados e revogar o consentimento para receber mensagens (respondendo SAIR, pelo portal ou pelo link do e-mail). O pedido é feito à empresa do empréstimo; o COROC ajuda a atendê-lo.',
      'Usuários do app: podem excluir a conta em Configurações › Excluir minha conta. O Proprietário exclui a conta encerrando a empresa.',
      `Brasil: LGPD (Lei 13.709/2018). Colômbia: Lei 1581 de 2012. Para dúvidas sobre privacidade: ${contact}.`,
    ] },
    { h: 'Menores de idade', p: ['O COROC é para empresas e seus clientes adultos. Não é destinado a menores de idade.'] },
    { h: 'Alterações', p: ['Se esta política mudar, será publicada aqui com a data e haverá aviso no app.'] },
  ],
});

const en = (contact: string): Policy => ({
  title: 'Privacy policy',
  updated: `Effective ${PRIVACY_VERSION}`,
  intro:
    'COROC is a portfolio management tool for lenders: it helps them keep track of customers, loans, payments and receipts. COROC does not offer or grant loans. This policy explains how personal data is handled in the app and in the borrower portal.',
  sections: [
    { h: 'Who is responsible', p: [
      'Each company that uses COROC is the controller of its customers’ (borrowers’) data and decides what it is used for. COROC acts as a processor: it handles the data only on behalf of the company and following its instructions.',
      'COROC is the controller of user account data (name, username, email and security data) it needs to provide the service.',
    ] },
    { h: 'What data is processed', p: [
      'About borrowers: name, ID document, phone numbers, email, address, loans, payments, receipts, the proofs of payment they send and the messages sent to them, with consent per channel.',
      'About app users: name, username, email, role, language, sessions and devices, and a log of their actions (audit trail).',
      'The app does not request access to contacts, SMS, location, background camera or the phone’s full storage. Files are only read when the person picks them or shares them with COROC.',
      'Data is not used for advertising, is not sold, and no one is tracked across apps or websites.',
    ] },
    { h: 'What it is used for', p: [
      'Managing the portfolio, recording payments, generating receipts and statements, reading proofs of payment sent by borrowers, sending the messages the company configures within the legal contact rules, and protecting accounts (two-factor authentication, lockout after failed attempts and audit trail).',
    ] },
    { h: 'Who it is shared with', p: [
      'Only with service providers under data processing agreements: hosting and encrypted storage, email delivery, WhatsApp Business (Meta) when the company enables it and, if the company turns it on, an artificial intelligence service that reads proofs of payment without retaining the data. It is never shared with other companies using COROC: each company is isolated from the others.',
    ] },
    { h: 'Security', p: [
      'Encrypted connections (TLS), documents encrypted at rest, signed download links that expire, passwords hashed with Argon2id, mandatory two-factor authentication for the Owner and isolation between companies in the database. Offline, the app keeps on the device only what is needed to look things up, encrypted with a key from the system’s secure storage, and deletes it on sign-out.',
    ] },
    { h: 'How long it is kept', p: [
      'For as long as the company uses COROC. Accounting entries and receipts are kept for the period required by the commercial and tax law of the company’s country.',
      'When a company is closed, its personal data is deleted after a 30-day grace period, except what the law requires to keep.',
    ] },
    { h: 'Your rights', p: [
      'Borrowers can access, update, correct and request deletion of their data, and withdraw consent to receive messages (by replying STOP, from the portal or with the email link). Requests go to the company that holds the loan; COROC helps it respond.',
      'App users can delete their account from Settings › Delete my account. The Owner deletes the account by closing the company.',
      `Colombia: Law 1581 of 2012. Brazil: LGPD (Law 13.709/2018). For any privacy question: ${contact}.`,
    ] },
    { h: 'Children', p: ['COROC is for businesses and their adult customers. It is not directed at children.'] },
    { h: 'Changes', p: ['If this policy changes, it will be published here with its date and announced in the app.'] },
  ],
});
