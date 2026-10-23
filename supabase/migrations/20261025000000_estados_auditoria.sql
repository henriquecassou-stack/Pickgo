-- Novos estados usados pelas correções da auditoria (arquivo separado: um valor
-- novo de enum só pode ser usado depois que a transação que o criou termina).

-- BUG-008: estorno e contestação (chargeback) de pagamento já aprovado
alter type status_pagamento add value if not exists 'estornado';
alter type status_pagamento add value if not exists 'contestado';
alter type status_venda add value if not exists 'estornada';

-- avisos ao administrador
alter type tipo_aviso add value if not exists 'estorno';                  -- BUG-008
alter type tipo_aviso add value if not exists 'venda_offline_rejeitada';  -- BUG-002/006
alter type tipo_aviso add value if not exists 'preco_divergente';         -- BUG-007
