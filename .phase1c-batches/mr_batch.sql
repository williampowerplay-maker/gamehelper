INSERT INTO phase1c_manual_review_20260425 (source_url, page_name, haiku_reason, old_content_type) VALUES
('https://crimsondesert.wiki.fextralife.com/Memory+Fragment','Memory Fragment','Mixed content about quest steps, items, and mechanics without clear primary focus.','quest'),
('https://crimsondesert.wiki.fextralife.com/House+Serkis','House Serkis','nav/faction overview without specific character/quest/location focus','character')
ON CONFLICT (source_url) DO NOTHING;
