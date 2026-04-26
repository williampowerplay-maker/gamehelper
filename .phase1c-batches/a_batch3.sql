INSERT INTO phase1c_classifications_20260425 (source_url, old_content_type, new_content_type) VALUES
('https://crimsondesert.wiki.fextralife.com/Southern_Guard_Post','character','exploration'),
('https://crimsondesert.wiki.fextralife.com/Southern_Quarry','character','exploration'),
('https://crimsondesert.wiki.fextralife.com/Southern_Riverside_Bandit_Camp','character','exploration'),
('https://crimsondesert.wiki.fextralife.com/Spearhead_Posthouse','character','exploration'),
('https://crimsondesert.wiki.fextralife.com/Spencer_Pistol','character','item'),
('https://crimsondesert.wiki.fextralife.com/St_Halsius%27s_Priest%27s_Hat','character','item'),
('https://crimsondesert.wiki.fextralife.com/St_Halssius_Priest_Attire','character','item')
ON CONFLICT (source_url) DO NOTHING;
